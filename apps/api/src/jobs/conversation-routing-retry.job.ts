import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { getSocketServer } from '../socket/index.js';
import {
  autoAssignConversation,
  ensureConversationRoutingInfrastructure,
} from '../modules/omnichannel/conversations/auto-assign.service.js';

interface ConversationRoutingRetryJobData {}

interface TenantSchemaRow {
  id: string;
  schema_name: string;
}

interface RoutingConversationRow {
  id: string;
  bot_option_id: string | null;
}

const QUEUE_NAME = 'ziradesk-conversation-routing-retry';
const CONVERSATION_ROUTING_RETRY_JOB_ID = 'conversation-routing-retry-every-30s';
const CONVERSATION_ROUTING_RETRY_EVERY_MS = 30_000;
const MAX_RETRY_PER_TENANT = 25;

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export const conversationRoutingRetryQueue = new Queue<ConversationRoutingRetryJobData>(QUEUE_NAME, {
  connection: bullmqConnection,
});

async function processRoutingRetryForAllTenants(): Promise<void> {
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
      await ensureConversationRoutingInfrastructure(prisma, tenant.schema_name);

      const conversationsRef = `${quoteIdent(tenant.schema_name)}.conversations`;
      const rows = await prisma.$queryRawUnsafe<RoutingConversationRow[]>(
        `SELECT id, bot_option_id
         FROM ${conversationsRef}
         WHERE status = 'open'
           AND assigned_to IS NULL
           AND routing_started_at IS NOT NULL
           AND COALESCE(metadata->>'bot_stage', '') <> 'waiting_choice'
           AND COALESCE(metadata->>'ai_agent_active', 'false') <> 'true'
         ORDER BY routing_started_at ASC, queue_entered_at ASC NULLS LAST, created_at ASC
         LIMIT $1::integer`,
        MAX_RETRY_PER_TENANT,
      );

      let assigned = 0;
      for (const row of rows) {
        const assignedAgentId = await autoAssignConversation(
          row.id,
          tenant.id,
          tenant.schema_name,
          prisma,
          io,
          undefined,
          row.bot_option_id ?? undefined,
        );
        if (assignedAgentId) assigned += 1;
      }

      if (assigned > 0) {
        logger.info({ tenantId: tenant.id, assigned }, '[ConversationRoutingRetry] Assigned conversations');
      }
    } catch (err) {
      logger.error({ tenantId: tenant.id, err }, '[ConversationRoutingRetry] Error processing tenant queue');
    }
  }
}

export const conversationRoutingRetryWorker = new Worker<ConversationRoutingRetryJobData>(
  QUEUE_NAME,
  async () => {
    await processRoutingRetryForAllTenants();
  },
  { connection: bullmqConnection, lockDuration: 30_000 },
);

conversationRoutingRetryWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, err: err instanceof Error ? err.message : String(err) },
    '[ConversationRoutingRetry] Job failed',
  );
});

void conversationRoutingRetryQueue.add(
  'conversation-routing-retry',
  {},
  {
    jobId: CONVERSATION_ROUTING_RETRY_JOB_ID,
    repeat: { every: CONVERSATION_ROUTING_RETRY_EVERY_MS },
    removeOnComplete: true,
    removeOnFail: true,
  },
).catch((err) => {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    '[ConversationRoutingRetry] Failed to schedule job',
  );
});
