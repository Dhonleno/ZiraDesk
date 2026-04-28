import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';

export const messageQueue = new Queue('ziradesk:messages', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});
