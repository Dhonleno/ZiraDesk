import { Queue } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';

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

export { knowledgeIndexQueue } from './knowledge-index.job.js';
