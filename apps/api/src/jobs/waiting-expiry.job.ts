import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { getSocketServer } from '../socket/index.js';

interface WaitingExpiryJobData {}

interface TenantSchemaRow {
  id: string;
  schema_name: string;
}

interface ClosedConversationRow {
  id: string;
}

const WAITING_EXPIRY_JOB_ID = 'waiting-expiry-every-15-minutes';
const WAITING_EXPIRY_INTERVAL_MS = 15 * 60 * 1000;

export const waitingExpiryQueue = new Queue<WaitingExpiryJobData>('ziradesk-waiting-expiry', {
  connection: redis,
});

async function closeExpiredWaitingConversations(): Promise<void> {
  const socketServer = (() => {
    try {
      return getSocketServer();
    } catch {
      return null;
    }
  })();

  const tenants = await prisma.$queryRawUnsafe<TenantSchemaRow[]>(
    `SELECT id, schema_name
     FROM tenants
     WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    try {
      const closedAt = new Date();
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${tenant.schema_name}", public`);
        return tx.$queryRawUnsafe<ClosedConversationRow[]>(
          `UPDATE conversations
           SET status = 'closed',
               closure_reason = $1::jsonb,
               closed_at = $2,
               resolved_at = $2,
               waiting_expires_at = NULL
           WHERE status = 'waiting'
             AND waiting_expires_at < NOW()
           RETURNING id`,
          JSON.stringify({
            reason: 'expired',
            notes: 'Sem resposta do cliente',
            resolvedAt: closedAt,
            agentId: null,
          }),
          closedAt,
        );
      });

      for (const conversation of rows) {
        socketServer?.to(`tenant:${tenant.id}`).emit('conversation:closed', {
          conversationId: conversation.id,
          reason: 'expired',
        });
      }

      if (rows.length > 0) {
        logger.info({ tenantId: tenant.id, count: rows.length }, '[WaitingExpiry] Closed expired conversations');
      }
    } catch (err) {
      logger.error({ tenantId: tenant.id, err }, '[WaitingExpiry] Error processing tenant');
    }
  }
}

export const waitingExpiryWorker = new Worker<WaitingExpiryJobData>(
  'ziradesk-waiting-expiry',
  async () => {
    await closeExpiredWaitingConversations();
  },
  { connection: redis },
);

waitingExpiryWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, '[WaitingExpiry] Job failed');
});

void waitingExpiryQueue.add(
  'waiting-expiry',
  {},
  {
    jobId: WAITING_EXPIRY_JOB_ID,
    repeat: { every: WAITING_EXPIRY_INTERVAL_MS },
    removeOnComplete: true,
    removeOnFail: true,
  },
).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[WaitingExpiry] Failed to schedule job');
});
