import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { verifyMetaSignature } from '../../middleware/meta-signature.js';
import { decryptCredentials } from '../../utils/crypto.js';
import { getSocketServer } from '../../socket/index.js';
import { ensureConversationProtocolInfrastructure } from '../omnichannel/conversations/protocols.js';
import { loadConversationSocketPayload } from '../omnichannel/conversations/socket-payload.js';

interface InstagramMessagingEntry {
  sender: { id: string };
  recipient: { id: string };
  message?: { text?: string; mid?: string };
}

interface InstagramPayload {
  object: string;
  entry: Array<{
    id: string;
    messaging?: InstagramMessagingEntry[];
  }>;
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
  status?: string | null;
}

async function findTenantByPageId(pageId: string) {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    let channels: ChannelRow[];
    try {
      channels = await prisma.$queryRawUnsafe<ChannelRow[]>(
        `SELECT id, credentials FROM "${tenant.schema_name}".channels WHERE type = 'instagram' AND status = 'active'`,
      );
    } catch (error) {
      logger.warn(
        { tenantId: tenant.id, schemaName: tenant.schema_name, err: error },
        '[Instagram] Failed to query channels for tenant schema',
      );
      continue;
    }

    for (const channel of channels) {
      let creds: Record<string, string>;
      try {
        creds = decryptCredentials(channel.credentials);
      } catch (error) {
        logger.warn(
          { tenantId: tenant.id, channelId: channel.id, err: error },
          '[Instagram] Invalid channel credentials payload',
        );
        continue;
      }
      if (creds['page_id'] === pageId) {
        return { tenant, channel, credentials: creds };
      }
    }
  }

  return null;
}

export async function instagramWebhookRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/webhooks/instagram — Meta webhook verification
  app.get<{
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>('/instagram', async (request, reply) => {
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }

    return reply.code(403).send({ error: 'Forbidden' });
  });

  // POST /api/webhooks/instagram — receive messages
  app.post<{ Body: InstagramPayload }>('/instagram', {
    config: { rawBody: true },
    preHandler: [verifyMetaSignature],
  }, async (request, reply) => {
    const payload = request.body;

    for (const entry of payload.entry ?? []) {
      const pageId = entry.id;
      const found = await findTenantByPageId(pageId);
      if (!found) continue;

      const { tenant, channel } = found;

      for (const messaging of entry.messaging ?? []) {
        const senderId = messaging.sender.id;
        const text = messaging.message?.text ?? '[mídia]';
        const externalId = messaging.message?.mid;

        const result = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL search_path TO "${tenant.schema_name}", public`,
          );
          await ensureConversationProtocolInfrastructure(tx, tenant.schema_name);

          const contactRows = await tx.$queryRawUnsafe<[{ id: string }]>(
            `SELECT id FROM contacts WHERE custom_fields->>'instagram_id' = $1 LIMIT 1`,
            senderId,
          );

          let contactId: string;
          if (contactRows[0]) {
            contactId = contactRows[0].id;
          } else {
            const newContact = await tx.$queryRawUnsafe<[{ id: string }]>(
              `INSERT INTO contacts (name, custom_fields)
               VALUES ($1, $2::jsonb) RETURNING id`,
              `Instagram user ${senderId}`,
              JSON.stringify({ instagram_id: senderId }),
            );
            contactId = newContact[0]!.id;
          }

          const convRows = await tx.$queryRawUnsafe<ConversationRow[]>(
            `SELECT id, status FROM conversations
             WHERE contact_id = $1::uuid
               AND channel_id = $2::uuid
               AND status IN ('open', 'waiting')
             ORDER BY created_at DESC
             LIMIT 1`,
            contactId,
            channel.id,
          );

          let conversationId: string;
          let changedFromWaiting = false;
          if (convRows[0]) {
            conversationId = convRows[0].id;
            if (convRows[0].status === 'waiting') {
              await tx.$executeRawUnsafe(
                `UPDATE conversations
                 SET status = 'open',
                     waiting_expires_at = NULL
                 WHERE id = $1::uuid`,
                conversationId,
              );
              changedFromWaiting = true;
            }
          } else {
            const newConv = await tx.$queryRawUnsafe<ConversationRow[]>(
              `INSERT INTO conversations (contact_id, channel_id, channel_type, conversation_type, status, metadata)
               VALUES ($1::uuid, $2::uuid, 'instagram', 'inbound', 'open', '{"type": "inbound"}'::jsonb)
               RETURNING id`,
              contactId,
              channel.id,
            );
            conversationId = newConv[0]!.id;
          }

          const msgRows = await tx.$queryRawUnsafe<
            [{ id: string; content: string; created_at: Date; sender_type: string }]
          >(
            `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, external_id, status)
             VALUES ($1::uuid, 'client', $2::uuid, $3, 'text', $4, 'delivered')
             RETURNING id, content, created_at, sender_type`,
            conversationId,
            contactId,
            text,
            externalId ?? null,
          );
          const message = msgRows[0]!;

          await tx.$executeRawUnsafe(
            `UPDATE conversations
             SET last_message = $1,
                 last_message_at = NOW()
             WHERE id = $2::uuid`,
            text.slice(0, 255),
            conversationId,
          );

          const assignmentRows = await tx.$queryRawUnsafe<Array<{
            assigned_to: string | null;
            contact_name: string | null;
            status: string | null;
          }>>(
            `SELECT c.assigned_to, c.status, ct.name AS contact_name
             FROM conversations c
             LEFT JOIN contacts ct ON ct.id = c.contact_id
             WHERE c.id = $1::uuid
             LIMIT 1`,
            conversationId,
          );
          const assignment = assignmentRows[0];

          return {
            conversationId,
            message,
            assignedUserId: assignment?.assigned_to ?? null,
            contactName: assignment?.contact_name ?? `Instagram user ${senderId}`,
            conversationStatus: assignment?.status ?? null,
            changedFromWaiting,
          };
        });

        const io = getSocketServer();
        const conversation = await loadConversationSocketPayload(
          prisma,
          tenant.schema_name,
          result.conversationId,
        );
        io.to(`tenant:${tenant.id}`).emit('conversation:message', {
          conversationId: result.conversationId,
          message: result.message,
          conversation: conversation ?? undefined,
        });
        if (result.changedFromWaiting) {
          io.to(`tenant:${tenant.id}`).emit('conversation:status_changed', {
            conversationId: result.conversationId,
            status: 'open',
          });
        }

        const senderType = result.message.sender_type;
        const preview = text.trim();
        if (result.assignedUserId && senderType === 'client') {
          const notificationPreview = preview.substring(0, 100) || `Mensagem de ${result.contactName}`;

          await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${tenant.schema_name}", public`);
            await tx.$executeRawUnsafe(
              `INSERT INTO audit_logs (
                 user_id, action, entity, entity_id, new_data, created_at
               ) VALUES (
                 $1::uuid,
                 'conversation.message',
                 'conversation',
                 $2::uuid,
                 $3::jsonb,
                 NOW()
               )`,
              result.assignedUserId,
              result.conversationId,
              JSON.stringify({
                assigned_to: result.assignedUserId,
                contact_name: result.contactName,
                preview: notificationPreview,
                channel: 'instagram',
              }),
            );
          });
        }
      }
    }

    return reply.send({ success: true });
  });
}
