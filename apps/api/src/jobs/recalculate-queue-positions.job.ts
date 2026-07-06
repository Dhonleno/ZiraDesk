import { Queue, Worker } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { notifyQueuePosition } from '../modules/omnichannel/queue/queue-notifications.service.js';
import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

interface RecalculateJobData {
  schemaName: string;
  tenantId: string;
}

export const recalculateQueuePositionsQueue = new Queue<RecalculateJobData>(
  'ziradesk-recalculate-queue-positions',
  {
    connection: bullmqConnection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  },
);

export const recalculateQueuePositionsWorker = new Worker<RecalculateJobData>(
  'ziradesk-recalculate-queue-positions',
  async (job) => {
    const { schemaName, tenantId } = job.data;

    const queueRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM ${quoteIdent(schemaName)}.conversations
       WHERE assigned_to IS NULL
         AND status = 'open'
         AND COALESCE(metadata->>'bot_stage', '') <> 'waiting_choice'
         AND COALESCE(metadata->>'ai_agent_active', 'false') <> 'true'
         AND queue_entered_at IS NOT NULL
       ORDER BY queue_entered_at ASC NULLS LAST, created_at ASC`,
    );

    for (const row of queueRows) {
      try {
        await notifyQueuePosition(schemaName, tenantId, row.id);
      } catch (err) {
        logger.warn(
          { err, conversationId: row.id, tenantId },
          '[RecalculateQueue] Failed to notify position for conversation',
        );
      }
    }

    logger.info(
      { tenantId, count: queueRows.length },
      '[RecalculateQueue] Recalculated queue positions',
    );
  },
  { connection: bullmqConnection },
);

recalculateQueuePositionsWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, err: err instanceof Error ? err.message : String(err) },
    '[RecalculateQueue] Job failed',
  );
});
