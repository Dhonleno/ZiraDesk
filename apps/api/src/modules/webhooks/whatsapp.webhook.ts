import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { messageQueue } from '../../jobs/queue.js';
import { getSocketServer } from '../../socket/index.js';
import { decryptCredentials } from '../../utils/crypto.js';
import {
  buildProtocolMessage,
  generateConversationProtocol,
} from '../omnichannel/conversations/protocols.js';

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
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: {
      details?: string;
      messaging_product?: string;
    };
  }>;
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
  credentials: string | object;
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findChannelByPhoneNumberId(
  phoneNumberId: string,
): Promise<{
  tenantId: string;
  schemaName: string;
  channelId: string;
  channelCredentials: Record<string, string>;
} | null> {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    const channels = await prisma.$queryRawUnsafe<ChannelRow[]>(
      `SELECT id, credentials FROM "${tenant.schema_name}".channels
       WHERE type = 'whatsapp' AND status = 'active'
       LIMIT 100`,
    );

    for (const channel of channels) {
      const credentials = decryptCredentials(channel.credentials);
      if (credentials['phoneNumberId'] === phoneNumberId) {
        return {
          tenantId: tenant.id,
          schemaName: tenant.schema_name,
          channelId: channel.id,
          channelCredentials: credentials as Record<string, string>,
        };
      }
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

  const { tenantId, schemaName, channelId, channelCredentials } = found;

  const formattedPhone = senderPhone.startsWith('55')
    ? `+${senderPhone}`
    : `+55${senderPhone}`;

  let content = '';
  let contentType = 'text';
  let externalMediaId: string | null = null;
  const mediaMetadata: Record<string, unknown> = {};

  switch (message.type) {
    case 'text':
      content = message.text?.body ?? '';
      contentType = 'text';
      break;
    case 'image':
      content = message.image?.caption ?? '📷 Imagem';
      contentType = 'image';
      externalMediaId = message.image?.id ?? null;
      if (message.image?.mime_type) mediaMetadata.mime_type = message.image.mime_type;
      break;
    case 'audio':
      content = '🎵 Áudio';
      contentType = 'audio';
      externalMediaId = message.audio?.id ?? null;
      if (message.audio?.mime_type) mediaMetadata.mime_type = message.audio.mime_type;
      break;
    case 'video':
      content = message.video?.caption ?? '🎬 Vídeo';
      contentType = 'video';
      externalMediaId = message.video?.id ?? null;
      if (message.video?.mime_type) mediaMetadata.mime_type = message.video.mime_type;
      break;
    case 'document':
      content = `📄 ${message.document?.filename ?? 'Documento'}`;
      contentType = 'document';
      externalMediaId = message.document?.id ?? null;
      if (message.document?.filename) mediaMetadata.filename = message.document.filename;
      if (message.document?.mime_type) mediaMetadata.mime_type = message.document.mime_type;
      break;
    default:
      content = '📎 Anexo';
      contentType = 'text';
  }

  if (externalMediaId) {
    mediaMetadata.media_id = externalMediaId;
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

    console.log('[WhatsApp] clientId:', clientId, 'channelId:', channelId);
    if (!isUuid(clientId) || !isUuid(channelId)) {
      throw new Error(`[WhatsApp] Invalid UUID for client/channel: ${clientId}/${channelId}`);
    }

    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1::text || ':' || $2::text)::bigint)`,
      clientId,
      channelId,
    );

    console.log('[WhatsApp Webhook] Looking for conversation:', { clientId, channelId });

    const convRows = await tx.$queryRawUnsafe<ConversationRow[]>(
      `SELECT id FROM conversations
       WHERE client_id = $1::uuid
         AND channel_id = $2::uuid
         AND status IN ('open', 'pending', 'active_outbound', 'in_service', 'bot')
       ORDER BY created_at DESC LIMIT 1`,
      clientId,
      channelId,
    );

    console.log('[WhatsApp Webhook] Found conversation:', convRows[0] ?? null);

    let conversationId: string;
    let isNewConversation = false;
    let protocolNumber: string | null = null;
    let protocolMessageId: string | null = null;
    let protocolMessageContent: string | null = null;
    if (convRows[0]) {
      conversationId = convRows[0].id;
    } else {
      protocolNumber = await generateConversationProtocol(tx, schemaName);
      const newConv = await tx.$queryRawUnsafe<ConversationRow[]>(
        `INSERT INTO conversations (client_id, channel_id, channel_type, conversation_type, status, protocol_number, metadata)
         VALUES ($1::uuid, $2::uuid, 'whatsapp', 'inbound', 'open', $3, '{"type": "inbound"}'::jsonb)
         RETURNING id`,
        clientId,
        channelId,
        protocolNumber,
      );
      conversationId = newConv[0]!.id;
      isNewConversation = true;
    }

    const msgRows = await tx.$queryRawUnsafe<
      [{ id: string; content: string; created_at: Date; sender_type: string }]
    >(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, media_url, external_id, status, metadata)
       VALUES ($1::uuid, 'client', $2::uuid, $3, $4, $5, $6, 'delivered', $7::jsonb)
       RETURNING id, content, created_at, sender_type`,
      conversationId,
      clientId,
      content,
      contentType,
      externalMediaId,
      message.id,
      JSON.stringify(mediaMetadata),
    );
    const savedMessage = msgRows[0]!;

    await tx.$executeRawUnsafe(
      `UPDATE conversations
       SET last_message = $1,
           last_message_at = NOW()
       WHERE id = $2::uuid`,
      content.slice(0, 255),
      conversationId,
    );

    if (isNewConversation && protocolNumber) {
      protocolMessageContent = buildProtocolMessage(protocolNumber);
      const protocolRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO messages (conversation_id, sender_type, content, content_type, is_internal)
         VALUES ($1::uuid, 'system', $2, 'text', false)
         RETURNING id`,
        conversationId,
        protocolMessageContent,
      );
      protocolMessageId = protocolRows[0]!.id;
    }

    return {
      conversationId,
      isNewConversation,
      message: savedMessage,
      protocolNumber,
      protocolMessageId,
      protocolMessageContent,
    };
  });

  const io = getSocketServer();
  if (result.isNewConversation) {
    io.to(`tenant:${tenantId}`).emit('conversation:created', {
      conversationId: result.conversationId,
    });
  }
  io.to(`tenant:${tenantId}`).emit('conversation:new_message', {
    conversationId: result.conversationId,
    message: result.message,
  });

  if (result.isNewConversation && result.protocolMessageId && result.protocolMessageContent) {
    await messageQueue.add('send', {
      messageId: result.protocolMessageId,
      conversationId: result.conversationId,
      tenantId,
      tenantSchema: schemaName,
      channelType: 'whatsapp',
      channelCredentials,
      content: result.protocolMessageContent,
      to: formattedPhone,
    });
  }

  // Notify assigned agent if conversation has one
  const convAssigned = await prisma.$queryRawUnsafe<[{ assigned_to: string | null; client_name: string | null }]>(
    `SELECT c.assigned_to, cl.name AS client_name
     FROM "${schemaName}".conversations c
     LEFT JOIN "${schemaName}".clients cl ON cl.id = c.client_id
     WHERE c.id = $1::uuid LIMIT 1`,
    result.conversationId,
  );
  const assignedUserId = convAssigned[0]?.assigned_to ?? null;
  if (assignedUserId) {
    const clientName = convAssigned[0]?.client_name ?? senderName;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".audit_logs (user_id, action, entity, entity_id, new_data)
       VALUES ($1::uuid, 'conversation.message', 'conversation', $2::uuid, $3::jsonb)`,
      assignedUserId,
      result.conversationId,
      JSON.stringify({ assigned_to: assignedUserId, conversationId: result.conversationId, clientName, preview: content.substring(0, 100) }),
    );
    io.to(`agent:${assignedUserId}`).emit('notification:new', {
      type: 'conversation.message',
      title: `Nova mensagem de ${clientName}`,
      message: content.substring(0, 80),
      conversationId: result.conversationId,
      createdAt: new Date().toISOString(),
    });
  }

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
  const statusMetadata = {
    whatsapp_status: status.status,
    webhook_timestamp: status.timestamp,
    recipient_id: status.recipient_id,
    errors: status.errors ?? null,
  };

  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    const result = await prisma.$queryRawUnsafe<MessageRow[]>(
      `UPDATE "${tenant.schema_name}".messages
       SET status = $1,
           metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE external_id = $2
       RETURNING id, conversation_id`,
      mappedStatus,
      status.id,
      JSON.stringify(statusMetadata),
    );

    if (result[0]) {
      if (status.status === 'failed') {
        console.error('[WhatsApp Status] Delivery failed', JSON.stringify({
          tenantId: tenant.id,
          messageId: result[0].id,
          conversationId: result[0].conversation_id,
          externalId: status.id,
          recipientId: status.recipient_id,
          errors: status.errors ?? null,
        }, null, 2));
      }

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
