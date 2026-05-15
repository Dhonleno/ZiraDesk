import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { indexArticle, getAIAgentConfig } from '../modules/ai/ai.service.js';
import { decryptCredentials } from '../utils/crypto.js';

interface KnowledgeIndexJobData {
  articleId: string;
  schemaName: string;
  tenantId: string;
}

export const knowledgeIndexQueue = new Queue<KnowledgeIndexJobData>('ziradesk-knowledge-index', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const knowledgeIndexWorker = new Worker<KnowledgeIndexJobData>(
  'ziradesk-knowledge-index',
  async (job) => {
    const { articleId, schemaName } = job.data;

    const config = await getAIAgentConfig(prisma, schemaName);
    if (!config?.openai_api_key) {
      throw new Error('Chave da API OpenAI não configurada');
    }

    const creds = decryptCredentials(config.openai_api_key);
    const apiKey = creds['key'] ?? config.openai_api_key;

    await indexArticle(prisma, schemaName, articleId, apiKey);
  },
  { connection: redis, concurrency: 2 },
);

knowledgeIndexWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, '[KnowledgeIndex] Job failed');
});
