import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { getSocketServer } from '../socket/index.js';
import { autoAssignNextQueuedConversation } from '../modules/omnichannel/conversations/auto-assign.service.js';

interface ProcessPendingQueueJobData {}

interface TenantSchemaRow {
  id: string;
  schema_name: string;
}

const PROCESS_PENDING_QUEUE_JOB_ID = 'process-pending-queue-every-2-minutes';
const PROCESS_INTERVAL_MS = 2 * 60 * 1000;
const MAX_ASSIGN_PER_TENANT = 5;

export const processPendingQueueQueue = new Queue<ProcessPendingQueueJobData>('ziradesk-process-pending-queue', {
  connection: bullmqConnection,
});

async function processPendingQueueForAllTenants(): Promise<void> {
  const io = (() => {
    try {
      return getSocketServer();
    } catch {
      return null;
    }
  })();

  if (!io) return;

  const tenants = await prisma.$queryRawUnsafe<TenantSchemaRow[]>(
    `SELECT id, schema_name
     FROM tenants
     WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    try {
      let assigned = 0;
      while (assigned < MAX_ASSIGN_PER_TENANT) {
        const result = await autoAssignNextQueuedConversation(
          tenant.id,
          tenant.schema_name,
          prisma,
          io,
        );
        if (!result) break;
        assigned++;
      }
      if (assigned > 0) {
        logger.info({ tenantId: tenant.id, assigned }, '[PendingQueue] Assigned pending conversations');
      }
    } catch (err) {
      logger.error({ tenantId: tenant.id, err }, '[PendingQueue] Error processing tenant queue');
    }
  }
}

export const processPendingQueueWorker = new Worker<ProcessPendingQueueJobData>(
  'ziradesk-process-pending-queue',
  async () => {
    await processPendingQueueForAllTenants();
  },
  { connection: bullmqConnection },
);

processPendingQueueWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, '[PendingQueue] Job failed');
});

void processPendingQueueQueue.add(
  'process-pending-queue',
  {},
  {
    jobId: PROCESS_PENDING_QUEUE_JOB_ID,
    repeat: { every: PROCESS_INTERVAL_MS },
    removeOnComplete: true,
    removeOnFail: true,
  },
).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[PendingQueue] Failed to schedule job');
});

