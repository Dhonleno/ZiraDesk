import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

interface CsatCleanupJobData {}

interface TenantSchemaRow {
  id: string;
  schema_name: string;
}

const CSAT_CLEANUP_EVERY_MS = 3_600_000;
const CSAT_CLEANUP_JOB_ID = 'cleanup-expired-csat-hourly';

export const csatCleanupQueue = new Queue<CsatCleanupJobData>('ziradesk-csat-cleanup', {
  connection: redis,
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
      const rows = await tx.$queryRawUnsafe<Array<{ updated: bigint }>>(
        `WITH expired AS (
           UPDATE conversations
           SET csat_stage = 'done',
               csat_expires_at = NULL
           WHERE csat_stage IN ('sent', 'waiting_comment')
             AND csat_expires_at IS NOT NULL
             AND csat_expires_at < NOW()
           RETURNING 1
         )
         SELECT COUNT(*)::bigint AS updated
         FROM expired`,
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
  { connection: redis },
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
