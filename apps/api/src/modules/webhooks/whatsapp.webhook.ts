import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { getSocketServer } from '../../socket/index.js';

interface MetaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker';
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; filename: string; mime_type: string };
}

interface MetaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: MetaMessage[];
        statuses?: MetaStatus[];
      };
      field: string;
    }>;
  }>;
}

interface TenantRow {
  id: string;
  schema_name: string;
}

interface ChannelRow {
  id: string;
}

interface ClientRow {
  id: string;
}

interface ConversationRow {
  id: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
}

async function findChannelByPhoneNumberId(
  phoneNumberId: string,
): Promise<{ tenantId: string; schemaName: string; channelId: string } | null> {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    const channels = await prisma.$queryRawUnsafe<ChannelRow[]>(
      `SELECT id FROM "${tenant.schema_name}".channels
       WHERE type = 'whatsapp' AND status = 'active'
       AND credentials->>'phoneNumberId' = $1
       LIMIT 1`,
      phoneNumberId,
    );

    if (channels[0]) {
      return { tenantId: tenant.id, schemaName: tenant.schema_name, channelId: channels[0].id };
    }
  }

  return null;
}

async function processIncomingMessage(
  _app: FastifyInstance,
  {
    phoneNumberId,
    senderPhone,
    senderName,
    message,
    wabaId: _wabaId,
  }: {
    phoneNumberId: string;
    senderPhone: string;
    senderName: string;
    message: MetaMessage;
    wabaId: string;
  },
) {
  const found = await findChannelByPhoneNumberId(phoneNumberId);
  if (!found) {
    console.warn(`[WhatsApp] No channel found for phoneNumberId: ${phoneNumberId}`);
    return;
  }

  const { tenantId, schemaName, channelId } = found;

  const formattedPhone = senderPhone.startsWith('55')
    ? `+${senderPhone}`
    : `+55${senderPhone}`;

  let content = '';
  let contentType = 'text';

  switch (message.type) {
    case 'text':
      content = message.text?.body ?? '';
      contentType = 'text';
      break;
    case 'image':
      content = message.image?.caption ?? '📷 Imagem';
      contentType = 'image';
      break;
    case 'audio':
      content = '🎵 Áudio';
      contentType = 'audio';
      break;
    case 'video':
      content = message.video?.caption ?? '🎬 Vídeo';
      contentType = 'video';
      break;
    case 'document':
      content = `📄 ${message.document?.filename ?? 'Documento'}`;
      contentType = 'document';
      break;
    default:
      content = '📎 Anexo';
      contentType = 'text';
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);

    const clientRows = await tx.$queryRawUnsafe<ClientRow[]>(
      `SELECT id FROM clients WHERE phone = $1 LIMIT 1`,
      formattedPhone,
    );

    let clientId: string;
    if (clientRows[0]) {
      clientId = clientRows[0].id;
    } else {
      const newClient = await tx.$queryRawUnsafe<ClientRow[]>(
        `INSERT INTO clients (name, phone, status) VALUES ($1, $2, 'lead') RETURNING id`,
        senderName,
        formattedPhone,
      );
      clientId = newClient[0]!.id;
    }

    const convRows = await tx.$queryRawUnsafe<ConversationRow[]>(
      `SELECT id FROM conversations
       WHERE client_id = $1::uuid AND channel_id = $2::uuid AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      clientId,
      channelId,
    );

    let conversationId: string;
    if (convRows[0]) {
      conversationId = convRows[0].id;
    } else {
      const newConv = await tx.$queryRawUnsafe<ConversationRow[]>(
        `INSERT INTO conversations (client_id, channel_id, channel_type, status)
         VALUES ($1::uuid, $2::uuid, 'whatsapp', 'open') RETURNING id`,
        clientId,
        channelId,
      );
      conversationId = newConv[0]!.id;
    }

    const msgRows = await tx.$queryRawUnsafe<
      [{ id: string; content: string; created_at: Date; sender_type: string }]
    >(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, external_id, status)
       VALUES ($1::uuid, 'client', $2::uuid, $3, $4, $5, 'delivered')
       RETURNING id, content, created_at, sender_type`,
      conversationId,
      clientId,
      content,
      contentType,
      message.id,
    );
    const savedMessage = msgRows[0]!;

    await tx.$executeRawUnsafe(
      `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2::uuid`,
      content.slice(0, 255),
      conversationId,
    );

    return { conversationId, message: savedMessage };
  });

  const io = getSocketServer();
  io.to(`tenant:${tenantId}`).emit('conversation:message', {
    conversationId: result.conversationId,
    message: result.message,
  });

  console.log(`[WhatsApp] Message processed: ${senderName} → ${content.substring(0, 50)}`);
}

async function processStatusUpdate(
  _app: FastifyInstance,
  status: MetaStatus,
) {
  const statusMap: Record<string, string> = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
  };
  const mappedStatus = statusMap[status.status] ?? 'sent';

  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    const result = await prisma.$queryRawUnsafe<MessageRow[]>(
      `UPDATE "${tenant.schema_name}".messages
       SET status = $1
       WHERE external_id = $2
       RETURNING id, conversation_id`,
      mappedStatus,
      status.id,
    );

    if (result[0]) {
      const io = getSocketServer();
      io.to(`tenant:${tenant.id}`).emit('message:status', {
        messageId: result[0].id,
        conversationId: result[0].conversation_id,
        status: mappedStatus,
      });
      break;
    }
  }
}

export async function whatsappWebhookRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/webhooks/whatsapp — Meta Cloud API webhook verification
  app.get('/whatsapp', async (request, reply) => {
    const {
      'hub.mode': mode,
      'hub.verify_token': verifyToken,
      'hub.challenge': challenge,
    } = request.query as Record<string, string>;

    if (mode === 'subscribe' && verifyToken === env.WHATSAPP_VERIFY_TOKEN) {
      return reply.status(200).send(challenge);
    }

    return reply.status(403).send({ error: 'Forbidden' });
  });

  // POST /api/webhooks/whatsapp — receive messages from Meta Cloud API
  app.post('/whatsapp', async (request, reply) => {
    // Meta requires a fast 200 response
    void reply.status(200).send({ success: true });

    const payload = request.body as MetaWebhookPayload;

    if (payload.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        if (value.statuses?.length) {
          for (const status of value.statuses) {
            await processStatusUpdate(app, status);
          }
          continue;
        }

        if (!value.messages?.length) continue;

        for (const message of value.messages) {
          const contact = value.contacts?.[0];
          const senderName = contact?.profile.name ?? message.from;
          const senderPhone = message.from;
          const phoneNumberId = value.metadata.phone_number_id;

          await processIncomingMessage(app, {
            phoneNumberId,
            senderPhone,
            senderName,
            message,
            wabaId: entry.id,
          });
        }
      }
    }
  });
}
