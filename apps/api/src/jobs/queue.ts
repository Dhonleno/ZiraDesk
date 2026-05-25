import { Queue } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';

export const messageQueue = new Queue('ziradesk-messages', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

export { knowledgeIndexQueue } from './knowledge-index.job.js';

