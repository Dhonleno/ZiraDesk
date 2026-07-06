import { Queue, Worker } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { runLgpdSlaScan } from '../lib/lgpd/sla.service.js';

interface LgpdSlaJobData {}

const LGPD_SLA_QUEUE_NAME = 'ziradesk-lgpd-sla';
const LGPD_SLA_JOB_ID = 'lgpd-sla-check';
const LGPD_SLA_EVERY_MS = 6 * 60 * 60 * 1000; // 6 hours

export const lgpdSlaQueue = new Queue<LgpdSlaJobData>(LGPD_SLA_QUEUE_NAME, {
  connection: bullmqConnection,
});

export const lgpdSlaWorker = new Worker<LgpdSlaJobData>(
  LGPD_SLA_QUEUE_NAME,
  async () => {
    logger.info('[LGPD SLA] Starting SLA scan');
    await runLgpdSlaScan();
    logger.info('[LGPD SLA] SLA scan completed');
  },
  { connection: bullmqConnection },
);

lgpdSlaWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, err: err instanceof Error ? err.message : String(err) },
    '[LGPD SLA] Job failed',
  );
});

void lgpdSlaQueue
  .add('lgpd-sla-run', {}, {
    jobId: LGPD_SLA_JOB_ID,
    repeat: { every: LGPD_SLA_EVERY_MS },
    removeOnComplete: true,
    removeOnFail: true,
  })
  .catch((err) => {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[LGPD SLA] Failed to schedule job',
    );
  });
