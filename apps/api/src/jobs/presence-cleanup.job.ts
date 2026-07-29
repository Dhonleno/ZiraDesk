import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { getSocketServer } from '../socket/index.js';
import { PRESENCE_TIMEOUT_MS } from '../modules/omnichannel/presence.constants.js';
import { ensureAgentAssignmentsInfrastructure } from '../modules/omnichannel/conversations/auto-assign.service.js';

interface PresenceCleanupJobData {}

interface TenantSchemaRow {
  id: string;
  schema_name: string;
}

interface OfflineAgentRow {
  user_id: string;
}

const PRESENCE_CLEANUP_JOB_ID = 'presence-cleanup-every-2-minutes';

export const presenceCleanupQueue = new Queue<PresenceCleanupJobData>('ziradesk-presence-cleanup', {
  connection: bullmqConnection,
});

async function cleanupStalePresence(): Promise<void> {
  const tenants = await prisma.$queryRawUnsafe<TenantSchemaRow[]>(
    `SELECT id, schema_name
     FROM tenants
     WHERE status IN ('active', 'trial')`,
  );

  const io = (() => {
    try {
      return getSocketServer();
    } catch {
      return null;
    }
  })();

  let skipped = 0;

  for (const tenant of tenants) {
    // Um tenant meio-provisionado não pode abortar a varredura — sem isso, os
    // agentes dos tenants seguintes ficariam "online" indefinidamente.
    try {
      await ensureAgentAssignmentsInfrastructure(prisma, tenant.schema_name);

      const staleAgents = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${tenant.schema_name}", public`);
        return tx.$queryRawUnsafe<OfflineAgentRow[]>(
          `UPDATE agent_assignments
           SET status = 'offline',
               is_available = false,
               online_since = NULL
           WHERE status = 'online'
             AND (
               last_seen_at IS NULL
               OR last_seen_at < NOW() - (${PRESENCE_TIMEOUT_MS / 1_000} * INTERVAL '1 second')
             )
           RETURNING user_id::text AS user_id`,
        );
      });

      if (!io) continue;
      for (const stale of staleAgents) {
        io.to(`tenant:${tenant.id}`).emit('agent:offline', { userId: stale.user_id });
      }
    } catch (err) {
      skipped += 1;
      logger.error(
        {
          tenantId: tenant.id,
          schemaName: tenant.schema_name,
          dbErrorCode: (err as { meta?: { code?: string } })?.meta?.code,
          err: err instanceof Error ? err.message : String(err),
        },
        '[Presence Cleanup] Skipping tenant — failed to clean stale presence',
      );
    }
  }

  if (skipped > 0) {
    logger.warn({ skipped, total: tenants.length }, '[Presence Cleanup] Sweep completed with skipped tenants');
  }
}

export const presenceCleanupWorker = new Worker<PresenceCleanupJobData>(
  'ziradesk-presence-cleanup',
  async () => {
    await cleanupStalePresence();
  },
  { connection: bullmqConnection },
);

presenceCleanupWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, '[Presence Cleanup] Job failed');
});

void presenceCleanupQueue.add(
  'cleanup-presence',
  {},
  {
    jobId: PRESENCE_CLEANUP_JOB_ID,
    repeat: { every: PRESENCE_TIMEOUT_MS },
    removeOnComplete: true,
    removeOnFail: true,
  },
).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Presence Cleanup] Failed to schedule cleanup job');
});

