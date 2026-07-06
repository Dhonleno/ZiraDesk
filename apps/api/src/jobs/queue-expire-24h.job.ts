import { Queue, Worker } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/database.js';
import { handle24hWindowExpiration } from '../modules/omnichannel/queue/queue-notifications.service.js';

interface QueueExpire24hJobData {}

interface TenantSchemaRow {
  id: string;
  schema_name: string;
}

const QUEUE_EXPIRE_24H_JOB_ID = 'queue-expire-24h-every-30-minutes';
const EXPIRE_INTERVAL_MS = 30 * 60 * 1000;

export const queueExpire24hQueue = new Queue<QueueExpire24hJobData>('ziradesk-queue-expire-24h', {
  connection: bullmqConnection,
});

export const queueExpire24hWorker = new Worker<QueueExpire24hJobData>(
  'ziradesk-queue-expire-24h',
  async () => {
    const tenants = await prisma.$queryRawUnsafe<TenantSchemaRow[]>(
      `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
    );

    for (const tenant of tenants) {
      try {
        await handle24hWindowExpiration(tenant.schema_name, tenant.id);
      } catch (err) {
        logger.error(
          { tenantId: tenant.id, err },
          '[QueueExpire24h] Error processing tenant',
        );
      }
    }
  },
  { connection: bullmqConnection },
);

queueExpire24hWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, err: err instanceof Error ? err.message : String(err) },
    '[QueueExpire24h] Job failed',
  );
});

void queueExpire24hQueue.add(
  'queue-expire-24h',
  {},
  {
    jobId: QUEUE_EXPIRE_24H_JOB_ID,
    repeat: { every: EXPIRE_INTERVAL_MS },
    removeOnComplete: true,
    removeOnFail: true,
  },
).catch((err) => {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    '[QueueExpire24h] Failed to schedule job',
  );
});
