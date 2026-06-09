import { prisma } from '../../config/database.js';
import { getSocketServer } from '../../socket/index.js';
import { dispatchWebhook } from '../../services/webhook-dispatcher.js';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

interface CloseFailedOutboundInput {
  schemaName: string;
  conversationId: string;
  messageId: string;
  provider: string;
  reason: string;
  tenantId?: string | null;
}

export async function closeFailedInitialOutbound({
  schemaName,
  conversationId,
  messageId,
  provider,
  reason,
  tenantId,
}: CloseFailedOutboundInput): Promise<boolean> {
  const schema = quoteIdent(schemaName);
  const closureReason = {
    reason: 'outbound_delivery_failed',
    provider,
    messageId,
    errorMessage: reason.slice(0, 500),
    closedAutomatically: true,
  };

  const closedRows = await prisma.$queryRawUnsafe<Array<{ id: string; closed_at: Date | null }>>(
    `UPDATE ${schema}.conversations c
     SET status = 'closed',
         closure_reason = $2::jsonb,
         closed_at = NOW(),
         resolved_at = NOW(),
         waiting_expires_at = NULL,
         queue_entered_at = NULL
     WHERE c.id = $1::uuid
       AND c.status = 'waiting'
       AND c.conversation_type = 'outbound'
       AND EXISTS (
         SELECT 1
         FROM ${schema}.messages initial_message
         WHERE initial_message.id = $3::uuid
           AND initial_message.conversation_id = c.id
           AND initial_message.status = 'failed'
       )
       AND (
         SELECT COUNT(*)
         FROM ${schema}.messages conversation_message
         WHERE conversation_message.conversation_id = c.id
       ) = 1
       AND NOT EXISTS (
         SELECT 1
         FROM ${schema}.messages client_message
         WHERE client_message.conversation_id = c.id
           AND client_message.sender_type = 'client'
       )
     RETURNING c.id::text, c.closed_at`,
    conversationId,
    JSON.stringify(closureReason),
    messageId,
  );

  const closedConversation = closedRows[0];
  if (!closedConversation) return false;

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs
       (user_id, action, entity, entity_id, new_data)
     VALUES (NULL, 'conversation.closed', 'conversation', $1::uuid, $2::jsonb)`,
    conversationId,
    JSON.stringify({
      status: 'closed',
      closure_reason: closureReason,
    }),
  );

  if (tenantId) {
    const io = getSocketServer();
    io.to(`tenant:${tenantId}`).emit('conversation:closed', { conversationId });
    void dispatchWebhook(tenantId, 'conversation.closed', {
      conversation: {
        id: conversationId,
        closedAt: closedConversation.closed_at,
        reason: closureReason.reason,
      },
    });
  }

  return true;
}
