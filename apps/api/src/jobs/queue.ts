import { Queue } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';

export interface ContactImportJobData {
  importId: string;
  mapping: {
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    whatsapp?: string | undefined;
    organization_name?: string | undefined;
    role?: string | undefined;
    department?: string | undefined;
    tags?: string | undefined;
    custom_fields?: string | undefined;
  };
  duplicateAction: 'skip' | 'update';
  tenantId: string;
  schemaName: string;
  userId: string;
}

export const messageQueue = new Queue('ziradesk-messages', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

export const campaignSendQueue = new Queue('ziradesk-campaign-send', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const contactImportQueue = new Queue<ContactImportJobData>('ziradesk-contact-import', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const usageSnapshotQueue = new Queue('usage-snapshot', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: 50,
    removeOnFail: 20,
  },
});

void usageSnapshotQueue
  .add('daily-flush', {}, {
    repeat: { pattern: '5 0 * * *' },
    jobId: 'usage-snapshot-daily-flush',
  })
  .catch((err: unknown) => {
    logger.error({ err }, '[UsageSnapshot] Failed to register repeatable job');
  });

export { knowledgeIndexQueue } from './knowledge-index.job.js';
