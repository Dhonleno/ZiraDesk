import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import {
  SYSTEM_CLOSE_TYPE_ID,
  SYSTEM_OUTCOME_IDS,
  buildSystemClosureReason,
} from '../database/seeds/closeConfig.seed.js';

interface CsatCleanupJobData {}

interface TenantSchemaRow {
  id: string;
  schema_name: string;
}

const CSAT_CLEANUP_EVERY_MS = 3_600_000;
const CSAT_CLEANUP_JOB_ID = 'cleanup-expired-csat-hourly';

export const csatCleanupQueue = new Queue<CsatCleanupJobData>('ziradesk-csat-cleanup', {
  connection: bullmqConnection,
});

async function cleanupExpiredCsat(): Promise<void> {
  const tenants = await prisma.$queryRawUnsafe<TenantSchemaRow[]>(
    `SELECT id, schema_name
     FROM tenants
     WHERE status IN ('active', 'trial')`,
  );

  let totalUpdated = 0;

  for (const tenant of tenants) {
    const safeSchemaName = tenant.schema_name.replace(/"/g, '""');
    const updatedCount = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);
      // Lote: todas as linhas compartilham o mesmo desfecho, então o JSONB é
      // constante. COALESCE preserva a classificação de quem encerrou antes do
      // CSAT ser enviado — o sweeper só preenche o que estiver vazio.
      const sweptAt = new Date();
      const rows = await tx.$queryRawUnsafe<Array<{ updated: bigint }>>(
        `WITH expired AS (
           UPDATE conversations
           SET csat_stage = 'done',
               csat_expires_at = NULL,
               status = 'closed',
               closed_at = COALESCE(closed_at, $1),
               resolved_at = COALESCE(resolved_at, $1),
               close_type_id = COALESCE(close_type_id, $2),
               close_outcome_id = COALESCE(close_outcome_id, $3),
               closure_reason = COALESCE(closure_reason, $4::jsonb)
           WHERE csat_stage IN ('sent', 'waiting_comment')
             AND csat_expires_at IS NOT NULL
             AND csat_expires_at < NOW()
           RETURNING 1
         )
         SELECT COUNT(*)::bigint AS updated
         FROM expired`,
        sweptAt,
        SYSTEM_CLOSE_TYPE_ID,
        SYSTEM_OUTCOME_IDS.AUTO_GENERIC,
        JSON.stringify(
          buildSystemClosureReason({
            reason: 'csat_expired',
            notes: 'CSAT expirado sem resposta do cliente',
            outcomeId: SYSTEM_OUTCOME_IDS.AUTO_GENERIC,
            resolvedAt: sweptAt,
          }),
        ),
      );
      return Number(rows[0]?.updated ?? 0n);
    });

    totalUpdated += updatedCount;
  }

  if (totalUpdated > 0) {
    logger.info({ totalUpdated }, '[CSAT Cleanup] Updated expired CSAT records');
  }
}

export const csatCleanupWorker = new Worker<CsatCleanupJobData>(
  'ziradesk-csat-cleanup',
  async () => {
    await cleanupExpiredCsat();
  },
  { connection: bullmqConnection },
);

csatCleanupWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, '[CSAT Cleanup] Job failed');
});

void csatCleanupQueue.add(
  'cleanup-expired-csat',
  {},
  {
    jobId: CSAT_CLEANUP_JOB_ID,
    repeat: { every: CSAT_CLEANUP_EVERY_MS },
    removeOnComplete: true,
    removeOnFail: true,
  },
).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[CSAT Cleanup] Failed to schedule hourly cleanup job');
});

