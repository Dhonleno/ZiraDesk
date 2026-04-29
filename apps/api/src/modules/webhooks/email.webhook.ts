import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { decryptCredentials } from '../../utils/crypto.js';
import { getSocketServer } from '../../socket/index.js';
import { ensureConversationProtocolInfrastructure } from '../omnichannel/conversations/protocols.js';

interface EmailPayload {
  from: string;
  subject?: string;
  text?: string;
  to: string[];
}

interface TenantRow {
  id: string;
  schema_name: string;
}

interface ChannelRow {
  id: string;
  credentials: string;
}

interface ConversationRow {
  id: string;
}

async function findTenantByEmailAddress(toAddress: string) {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    const channels = await prisma.$queryRawUnsafe<ChannelRow[]>(
      `SELECT id, credentials FROM "${tenant.schema_name}".channels WHERE type = 'email' AND status = 'active'`,
    );

    for (const channel of channels) {
      const creds = decryptCredentials(channel.credentials);
      if (creds['inbound_address'] === toAddress) {
        return { tenant, channel, credentials: creds };
      }
    }
  }

  return null;
}

export async function emailWebhookRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/webhooks/email — receive inbound emails from Resend
  app.post<{ Body: EmailPayload }>('/email', async (request, reply) => {
    const { from, subject, text, to } = request.body;

    const toAddress = to[0];
    if (!toAddress) return reply.send({ success: true });

    const found = await findTenantByEmailAddress(toAddress);
    if (!found) return reply.send({ success: true });

    const { tenant, channel } = found;
    const content = text ?? subject ?? '[sem conteúdo]';
    const senderEmail = from.includes('<')
      ? (from.match(/<(.+)>/)?.[1] ?? from)
      : from;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL search_path TO "${tenant.schema_name}", public`,
      );
      await ensureConversationProtocolInfrastructure(tx, tenant.schema_name);

      const clientRows = await tx.$queryRawUnsafe<[{ id: string }]>(
        `SELECT id FROM clients WHERE email = $1 LIMIT 1`,
        senderEmail,
      );

      let clientId: string;
      if (clientRows[0]) {
        clientId = clientRows[0].id;
      } else {
        const name = from.includes('<')
          ? from.split('<')[0]?.trim() ?? senderEmail
          : senderEmail;
        const newClient = await tx.$queryRawUnsafe<[{ id: string }]>(
          `INSERT INTO clients (name, email, status) VALUES ($1, $2, 'lead') RETURNING id`,
          name,
          senderEmail,
        );
        clientId = newClient[0]!.id;
      }

      const convRows = await tx.$queryRawUnsafe<ConversationRow[]>(
        `SELECT id FROM conversations
         WHERE client_id = $1 AND channel_id = $2 AND status IN ('open', 'pending', 'active_outbound', 'in_service', 'bot')
         ORDER BY created_at DESC
         LIMIT 1`,
        clientId,
        channel.id,
      );

      let conversationId: string;
      if (convRows[0]) {
        conversationId = convRows[0].id;
      } else {
        const newConv = await tx.$queryRawUnsafe<ConversationRow[]>(
          `INSERT INTO conversations (client_id, channel_id, channel_type, conversation_type, status, subject, metadata)
           VALUES ($1, $2, 'email', 'inbound', 'open', $3, '{"type": "inbound"}'::jsonb)
           RETURNING id`,
          clientId,
          channel.id,
          subject ?? null,
        );
        conversationId = newConv[0]!.id;
      }

      const msgRows = await tx.$queryRawUnsafe<
        [{ id: string; content: string; created_at: Date; sender_type: string }]
      >(
        `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, status)
         VALUES ($1, 'client', $2, $3, 'text', 'delivered')
         RETURNING id, content, created_at, sender_type`,
        conversationId,
        clientId,
        content,
      );
      const message = msgRows[0]!;

      await tx.$executeRawUnsafe(
        `UPDATE conversations
         SET last_message = $1,
             last_message_at = NOW()
         WHERE id = $2`,
        content.slice(0, 255),
        conversationId,
      );

      return { conversationId, message };
    });

    const io = getSocketServer();
    io.to(`tenant:${tenant.id}`).emit('conversation:message', {
      conversationId: result.conversationId,
      message: result.message,
    });

    return reply.send({ success: true });
  });
}
