import { Worker } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { flushAllTenantsUsage } from '../services/usage.service.js';

export const usageSnapshotWorker = new Worker(
  'usage-snapshot',
  async () => {
    logger.info('[UsageSnapshot] Starting daily flush');
    await flushAllTenantsUsage();
    logger.info('[UsageSnapshot] Daily flush complete');
  },
  { connection: bullmqConnection },
);
