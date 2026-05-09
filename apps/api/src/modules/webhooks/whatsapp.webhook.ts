import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { redis } from '../../config/redis.js';
import { messageQueue } from '../../jobs/queue.js';
import { getSocketServer } from '../../socket/index.js';
import { decryptCredentials } from '../../utils/crypto.js';
import {
  ensureBotInfrastructure,
  processBotMessage,
} from '../admin/bot/bot.service.js';
import {
  getBusinessHoursStatus,
  isWithinBusinessHours,
} from '../admin/business-hours/business-hours.service.js';
import {
  buildProtocolMessage,
  callGenerateProtocol,
  ensureConversationProtocolInfrastructure,
} from '../omnichannel/conversations/protocols.js';
import { autoAssignConversation } from '../omnichannel/conversations/auto-assign.service.js';
import { ensureConversationCsatInfrastructure } from '../omnichannel/conversations/csat.infrastructure.js';
import {
  buildCsatCommentRequestMessage,
  buildCsatInvalidScoreMessage,
  buildCsatThankYouMessage,
  sendWhatsAppTextMessage,
} from '../omnichannel/conversations/csat.service.js';
import {
  cancelInactivityJobs,
  getTenantInactivitySettings,
  scheduleInactivityCheck,
} from '../../jobs/inactivity.job.js';
import { PRESENCE_TIMEOUT_MS } from '../omnichannel/presence.constants.js';

interface MetaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'reaction';
  context?: {
    id?: string;
    from?: string;
  };
  reaction?: {
    message_id?: string;
    emoji?: string;
  };
  sticker?: {
    id?: string;
    mime_type?: string;
    animated?: boolean;
  };
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
    href?: string;
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

interface TenantSettingsRow {
  settings: unknown;
}

interface ChannelRow {
  id: string;
  credentials: string | object;
}

interface ContactRow {
  id: string;
  name: string;
  organization_id: string | null;
}

interface ConversationRow {
  id: string;
  assigned_to?: string | null;
  outbound_origin_agent_id?: string | null;
  outbound_expires_at?: Date | null;
  bot_stage?: string | null;
  status?: string;
  csat_stage?: 'sent' | 'waiting_comment' | 'done' | null;
  csat_score?: number | null;
  csat_expires_at?: Date | null;
}

interface AvailableAgentRow {
  user_id: string;
  name: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
}

interface ConversationStatusRow {
  id: string;
  status: string;
}

interface ChannelMatch {
  tenantId: string;
  schemaName: string;
  channelId: string;
  channelCredentials: Record<string, string>;
}

interface MentionLookupRow {
  id: string;
  sender_type: string;
  content: string | null;
  content_type: string;
  media_url: string | null;
  metadata: unknown;
  external_id: string | null;
  agent_name: string | null;
  contact_name: string | null;
}

interface ActiveConversationByPhoneRow {
  id: string;
}

const ACTIVE_CONVERSATION_STATUSES = "'open', 'pending', 'active_outbound', 'in_service', 'in_progress', 'bot'";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getCredentialValue(credentials: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = credentials[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function withWhatsappEnvFallback(credentials: Record<string, string>): Record<string, string> {
  return {
    ...credentials,
    phoneNumberId: getCredentialValue(credentials, 'phoneNumberId', 'phone_number_id') ?? env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: getCredentialValue(credentials, 'wabaId', 'waba_id') ?? env.WHATSAPP_WABA_ID,
    accessToken: getCredentialValue(credentials, 'accessToken', 'access_token') ?? env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: getCredentialValue(credentials, 'verifyToken', 'verify_token') ?? env.WHATSAPP_VERIFY_TOKEN,
  };
}

function buildMentionPreview(content: string | null | undefined, contentType: string): string {
  const normalized = (content ?? '').trim();
  if (normalized) return normalized.slice(0, 255);

  switch (contentType) {
    case 'image':
      return '[Imagem]';
    case 'audio':
      return '[Áudio]';
    case 'video':
      return '[Vídeo]';
    case 'document':
      return '[Documento]';
    default:
      return '[Mensagem]';
  }
}

function buildMentionSenderLabel(row: MentionLookupRow): string {
  if (row.sender_type === 'agent') return row.agent_name ?? 'Agente';
  if (row.sender_type === 'bot') return 'Bot';
  if (row.sender_type === 'system') return 'Sistema';
  return row.contact_name ?? 'Cliente';
}

function getMentionMediaId(row: MentionLookupRow): string | null {
  if (row.media_url?.trim()) return row.media_url.trim();
  if (!row.metadata || typeof row.metadata !== 'object') return null;
  const mediaId = (row.metadata as Record<string, unknown>).media_id;
  return typeof mediaId === 'string' && mediaId.trim() ? mediaId.trim() : null;
}

function getMentionMediaSubtype(row: MentionLookupRow): string | null {
  if (!row.metadata || typeof row.metadata !== 'object') return null;
  const mediaSubtype = (row.metadata as Record<string, unknown>).media_subtype;
  return typeof mediaSubtype === 'string' && mediaSubtype.trim() ? mediaSubtype.trim() : null;
}

async function findBestAvailableAgent(
  tx: Pick<typeof prisma, '$queryRawUnsafe'>,
  preferredAgentId?: string | null,
): Promise<AvailableAgentRow | null> {
  if (preferredAgentId) {
    const preferredRows = await tx.$queryRawUnsafe<AvailableAgentRow[]>(
      `SELECT aa.user_id, u.name
       FROM agent_assignments aa
       JOIN users u ON u.id = aa.user_id
       WHERE aa.user_id = $1::uuid
         AND aa.is_available = true
         AND aa.status = 'online'
         AND aa.last_seen_at > NOW() - (${PRESENCE_TIMEOUT_MS / 60_000} * INTERVAL '1 minute')
         AND u.status = 'active'
         AND u.role IN ('owner', 'admin', 'agent')
       LIMIT 1`,
      preferredAgentId,
    );

    if (preferredRows[0]) return preferredRows[0];
  }

  const rows = await tx.$queryRawUnsafe<AvailableAgentRow[]>(
    `SELECT aa.user_id, u.name
     FROM agent_assignments aa
     JOIN users u ON u.id = aa.user_id
     WHERE aa.is_available = true
       AND aa.status = 'online'
       AND aa.last_seen_at > NOW() - (${PRESENCE_TIMEOUT_MS / 60_000} * INTERVAL '1 minute')
       AND u.status = 'active'
       AND u.role IN ('owner', 'admin', 'agent')
     ORDER BY aa.last_assigned_at ASC
     LIMIT 1`,
  );

  return rows[0] ?? null;
}

async function syncActiveConversationCounters(
  tx: Pick<typeof prisma, '$executeRawUnsafe'>,
  userIds: Array<string | null | undefined>,
): Promise<void> {
  const unique = Array.from(new Set(userIds.filter((value): value is string => Boolean(value))));
  for (const userId of unique) {
    await tx.$executeRawUnsafe(
      `UPDATE agent_assignments aa
       SET active_conversations = (
         SELECT COUNT(*)::integer
         FROM conversations c
         WHERE c.assigned_to = aa.user_id
           AND c.status IN ('open', 'in_service', 'pending', 'bot')
       )
       WHERE aa.user_id = $1::uuid`,
      userId,
    );
  }
}

async function findChannelByPhoneNumberId(
  phoneNumberId: string,
): Promise<ChannelMatch | null> {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );
  const envFallbackMatches: ChannelMatch[] = [];

  for (const tenant of tenants) {
    const channels = await prisma.$queryRawUnsafe<ChannelRow[]>(
      `SELECT id, credentials FROM "${tenant.schema_name}".channels
       WHERE type = 'whatsapp' AND status = 'active'
       LIMIT 100`,
    );

    for (const channel of channels) {
      const credentials = decryptCredentials(channel.credentials);
      const channelPhoneNumberId = getCredentialValue(credentials, 'phoneNumberId', 'phone_number_id');
      console.log(`[WhatsApp] Channel ${channel.id} decrypted keys: [${Object.keys(credentials).join(', ')}] | phoneNumberId="${channelPhoneNumberId ?? 'undefined'}" (seeking: "${phoneNumberId}")`);
      if (channelPhoneNumberId === phoneNumberId) {
        return {
          tenantId: tenant.id,
          schemaName: tenant.schema_name,
          channelId: channel.id,
          channelCredentials: withWhatsappEnvFallback(credentials as Record<string, string>),
        };
      }

      if (!channelPhoneNumberId && env.WHATSAPP_PHONE_NUMBER_ID === phoneNumberId) {
        envFallbackMatches.push({
          tenantId: tenant.id,
          schemaName: tenant.schema_name,
          channelId: channel.id,
          channelCredentials: withWhatsappEnvFallback(credentials as Record<string, string>),
        });
      }
    }
  }

  if (envFallbackMatches.length === 1) {
    console.warn(`[WhatsApp] Using .env fallback for phoneNumberId ${phoneNumberId}; channel credentials are missing phoneNumberId`);
    return envFallbackMatches[0]!;
  }

  if (envFallbackMatches.length > 1) {
    console.warn(`[WhatsApp] Ambiguous .env fallback for phoneNumberId ${phoneNumberId}; ${envFallbackMatches.length} channels without phoneNumberId`);
  }

  return null;
}

function getLocalWeekday(timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const weekday = formatter.format(new Date());
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return weekdayMap[weekday] ?? 0;
}

async function getNextOpenTime(
  timezone: string,
  schemaName: string,
): Promise<string | null> {
  const status = await getBusinessHoursStatus(timezone, prisma, schemaName);
  if (status.next_open_day === null || !status.next_open_time) return null;

  const currentDay = getLocalWeekday(timezone);
  if (status.next_open_day === currentDay) {
    return `hoje às ${status.next_open_time}`;
  }

  const dayNames = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
  ];
  const dayName = dayNames[status.next_open_day] ?? 'em breve';
  return `${dayName} às ${status.next_open_time}`;
}

async function insertBotMessage(
  conversationId: string,
  schemaName: string,
  content: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".messages (
      id, conversation_id, sender_type, content, content_type, is_internal, created_at
    )
    VALUES (
      gen_random_uuid(), $1::uuid, 'bot', $2, 'text', false, NOW()
    )`,
    conversationId,
    content,
  );
}

async function closeConversationOutsideHours(
  conversationId: string,
  schemaName: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "${schemaName}".conversations
     SET status = 'closed',
         resolved_at = NOW()
     WHERE id = $1::uuid
       AND status IN (${ACTIVE_CONVERSATION_STATUSES})`,
    conversationId,
  );
}

async function handleOutsideBusinessHours({
  tenantId,
  tenantSettings,
  schemaName,
  channelId,
  senderPhone,
  formattedPhone,
  channelCredentials,
}: {
  tenantId: string;
  tenantSettings: Record<string, unknown>;
  schemaName: string;
  channelId: string;
  senderPhone: string;
  formattedPhone: string;
  channelCredentials: Record<string, string>;
}): Promise<void> {
  const timezone = (tenantSettings.timezone as string | undefined) ?? 'America/Sao_Paulo';
  const awayMessageEnabled = tenantSettings.away_message_enabled !== false;
  const awayMessage = (tenantSettings.away_message as string | undefined)
    ?? 'Olá! No momento estamos fora do horário de atendimento.';

  const openConversationRows = await prisma.$queryRawUnsafe<ActiveConversationByPhoneRow[]>(
    `SELECT c.id
     FROM "${schemaName}".conversations c
     JOIN "${schemaName}".contacts ct ON ct.id = c.contact_id
     WHERE c.channel_id = $1::uuid
       AND (ct.whatsapp = $2 OR ct.phone = $2)
       AND c.status IN (${ACTIVE_CONVERSATION_STATUSES})
     ORDER BY c.created_at DESC
     LIMIT 1`,
    channelId,
    formattedPhone,
  );
  const conversationId = openConversationRows[0]?.id ?? null;

  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const redisKey = conversationId
    ? `away_conv:${conversationId}:${todayKey}`
    : `away_phone:${tenantId}:${senderPhone}:${todayKey}`;
  const alreadySent = await redis.get(redisKey);

  if (!alreadySent && awayMessageEnabled) {
    const nextOpenInfo = await getNextOpenTime(timezone, schemaName);
    const fullMessage = [
      awayMessage,
      '',
      nextOpenInfo
        ? `⏰ Retornaremos ${nextOpenInfo}.`
        : '⏰ Retorne durante nosso horário de atendimento.',
      '',
      'Este atendimento será encerrado. Até logo! 👋',
    ].join('\n');

    const phoneNumberId = getCredentialValue(channelCredentials, 'phoneNumberId', 'phone_number_id');
    const accessToken = getCredentialValue(channelCredentials, 'accessToken', 'access_token');
    if (phoneNumberId && accessToken) {
      const sent = await sendWhatsAppTextMessage({
        text: fullMessage,
        to: senderPhone,
        phoneNumberId,
        accessToken,
      });

      if (sent) {
        if (conversationId) {
          await insertBotMessage(conversationId, schemaName, fullMessage);
        }
        await redis.setex(redisKey, 86400, '1');
      }
    }
  }

  if (!conversationId) return;

  await cancelInactivityJobs(conversationId);
  await closeConversationOutsideHours(conversationId, schemaName);
  const io = getSocketServer();
  io.to(`tenant:${tenantId}`).emit('conversation:updated', {
    conversationId,
    status: 'closed',
  });
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
  const tenantRows = await prisma.$queryRawUnsafe<TenantSettingsRow[]>(
    'SELECT settings FROM tenants WHERE id = $1 LIMIT 1',
    tenantId,
  );
  const tenantSettings = (tenantRows[0]?.settings as Record<string, unknown> | null) ?? {};
  const timezone = (tenantSettings.timezone as string | undefined) ?? 'America/Sao_Paulo';
  const isOpen = await isWithinBusinessHours(prisma, timezone, schemaName);

  if (!isOpen) {
    await handleOutsideBusinessHours({
      tenantId,
      tenantSettings,
      schemaName,
      channelId,
      senderPhone,
      formattedPhone,
      channelCredentials,
    });
    return;
  }

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
      content = message.image?.caption?.trim() ?? '';
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
    case 'sticker':
      content = '🧩 Figurinha';
      contentType = 'image';
      externalMediaId = message.sticker?.id ?? null;
      if (message.sticker?.mime_type) mediaMetadata.mime_type = message.sticker.mime_type;
      if (typeof message.sticker?.animated === 'boolean') mediaMetadata.sticker_animated = message.sticker.animated;
      mediaMetadata.media_subtype = 'sticker';
      break;
    case 'reaction':
      content = message.reaction?.emoji?.trim() || 'Reação removida';
      contentType = 'text';
      break;
    default:
      content = '📎 Anexo';
      contentType = 'text';
  }

  if (externalMediaId) {
    mediaMetadata.media_id = externalMediaId;
  }
  const quotedExternalId =
    message.context?.id?.trim()
    || message.reaction?.message_id?.trim()
    || null;

  // Ensure schema/function exists outside the transaction to avoid concurrent DDL errors
  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  await ensureBotInfrastructure(prisma, schemaName);
  const outsideBusinessHours = false;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);

    const contactRows = await tx.$queryRawUnsafe<ContactRow[]>(
      `SELECT id, name, organization_id FROM contacts
       WHERE whatsapp = $1 OR phone = $1
       LIMIT 1`,
      formattedPhone,
    );

    let contactId: string;
    let organizationId: string | null = null;
    if (contactRows[0]) {
      contactId = contactRows[0].id;
      organizationId = contactRows[0].organization_id;
    } else {
      const newContact = await tx.$queryRawUnsafe<ContactRow[]>(
        `INSERT INTO contacts (name, whatsapp, phone) VALUES ($1, $2, $2) RETURNING id, name, organization_id`,
        senderName,
        formattedPhone,
      );
      contactId = newContact[0]!.id;
      organizationId = null;
    }

    console.log('[WhatsApp] contactId:', contactId, 'channelId:', channelId);
    if (!isUuid(contactId) || !isUuid(channelId)) {
      throw new Error(`[WhatsApp] Invalid UUID for contact/channel: ${contactId}/${channelId}`);
    }

    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1::text || ':' || $2::text)::bigint)`,
      contactId,
      channelId,
    );

    console.log('[WhatsApp Webhook] Looking for conversation:', { contactId, channelId });

    await tx.$executeRawUnsafe(
      `UPDATE conversations
       SET status = 'closed',
           closed_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE contact_id = $1::uuid
         AND channel_id = $2::uuid
         AND status = 'active_outbound'
         AND outbound_expires_at IS NOT NULL
         AND outbound_expires_at <= NOW()`,
      contactId,
      channelId,
      JSON.stringify({
        active_outbound_expired: true,
        active_outbound_expired_at: new Date().toISOString(),
      }),
    );

    const convRows = await tx.$queryRawUnsafe<ConversationRow[]>(
      `SELECT id, status, csat_stage, csat_score, csat_expires_at
              , assigned_to
              , outbound_origin_agent_id
              , outbound_expires_at
              , metadata->>'bot_stage' AS bot_stage
       FROM conversations
       WHERE contact_id = $1::uuid
         AND channel_id = $2::uuid
         AND (
           status IN (${ACTIVE_CONVERSATION_STATUSES})
           OR (
             status = 'resolved'
             AND csat_stage IN ('sent', 'waiting_comment')
           )
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      contactId,
      channelId,
    );

    console.log('[WhatsApp Webhook] Found conversation:', convRows[0] ?? null);

    let conversationId: string;
    let isNewConversation = false;
    let protocolNumber: string | null = null;
    let protocolMessageId: string | null = null;
    let protocolMessageContent: string | null = null;
    let botMessageId: string | null = null;
    let botMessageContent: string | null = null;
    let botSavedMessage: { id: string; content: string; created_at: Date; sender_type: string } | null = null;
    if (convRows[0]) {
      conversationId = convRows[0].id;
    } else {
      protocolNumber = await callGenerateProtocol(tx, schemaName);
      const newConv = await tx.$queryRawUnsafe<ConversationRow[]>(
        `INSERT INTO conversations (contact_id, organization_id, channel_id, channel_type, conversation_type, status, protocol_number, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'whatsapp', 'inbound', 'open', $4, $5::jsonb)
         RETURNING id`,
        contactId,
        organizationId,
        channelId,
        protocolNumber,
        JSON.stringify({
          type: 'inbound',
          outside_business_hours: outsideBusinessHours,
        }),
      );
      conversationId = newConv[0]!.id;
      isNewConversation = true;
    }

    await tx.$executeRawUnsafe(
      `UPDATE conversations
       SET metadata = COALESCE(metadata, '{}'::jsonb)
         - 'whatsapp_reengagement_required'
         - 'whatsapp_reengagement_failed_at'
         - 'whatsapp_reengagement_error_code'
         - 'whatsapp_reengagement_error_title'
         - 'whatsapp_reengagement_error_message'
         - 'whatsapp_reengagement_error_details'
       WHERE id = $1::uuid`,
      conversationId,
    );

    const currentConversation = convRows[0] ?? null;
    const currentCsatStage = currentConversation?.csat_stage ?? null;
    const currentCsatScore = currentConversation?.csat_score ?? null;
    const currentCsatExpiresAt = currentConversation?.csat_expires_at ?? null;
    const isActiveOutboundReturnFlow = currentConversation?.status === 'active_outbound';

    let mentionMetadata: Record<string, unknown> | null = null;
    if (quotedExternalId) {
      const mentionRows = await tx.$queryRawUnsafe<MentionLookupRow[]>(
        `SELECT
           m.id,
           m.sender_type,
           m.content,
           m.content_type,
           m.media_url,
           m.metadata,
           m.external_id,
           u.name AS agent_name,
           ct.name AS contact_name
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         WHERE m.external_id = $1
           AND m.conversation_id = $2::uuid
         ORDER BY m.created_at DESC
         LIMIT 1`,
        quotedExternalId,
        conversationId,
      );
      const mention = mentionRows[0];
      if (mention) {
        mentionMetadata = {
          message_id: mention.id,
          sender_type: mention.sender_type,
          sender_label: buildMentionSenderLabel(mention),
          content: buildMentionPreview(mention.content, mention.content_type),
          content_type: mention.content_type,
          external_id: mention.external_id,
          media_id: getMentionMediaId(mention),
          media_subtype: getMentionMediaSubtype(mention),
        };
      }
    }

    const incomingMessageMetadata: Record<string, unknown> = {
      ...mediaMetadata,
      ...(mentionMetadata ? { mention: mentionMetadata } : {}),
    };

    const isCsatPending = currentCsatStage === 'sent' || currentCsatStage === 'waiting_comment';
    let shouldHandleCsat = isCsatPending;

    if (isCsatPending) {
      const csatExpired = currentCsatExpiresAt
        && new Date() > new Date(currentCsatExpiresAt);

      if (csatExpired) {
        await tx.$executeRawUnsafe(
          `UPDATE conversations
           SET csat_stage = 'done',
               csat_expires_at = NULL
           WHERE id = $1::uuid`,
          conversationId,
        );
        shouldHandleCsat = false;
      }
    }

    if (shouldHandleCsat) {
      const msgRows = await tx.$queryRawUnsafe<
        [{ id: string; content: string; created_at: Date; sender_type: string }]
      >(
        `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, media_url, external_id, status, metadata)
         VALUES ($1::uuid, 'client', $2::uuid, $3, $4, $5, $6, 'delivered', $7::jsonb)
         RETURNING id, content, created_at, sender_type`,
        conversationId,
        contactId,
        content,
        contentType,
        externalMediaId,
        message.id,
        JSON.stringify(incomingMessageMetadata),
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

      let replyText: string;
      let csatPayload: { csat_score: number | null; csat_comment?: string | null } | null = null;
      if (currentCsatStage === 'sent') {
        const normalized = content.trim();
        const score = Number.parseInt(normalized, 10);
        if (score >= 1 && score <= 5) {
          await tx.$executeRawUnsafe(
            `UPDATE conversations
             SET csat_score = $1,
                 csat_stage = 'waiting_comment',
                 csat_responded_at = NOW()
             WHERE id = $2::uuid`,
            score,
            conversationId,
          );
          replyText = buildCsatCommentRequestMessage(score);
          csatPayload = { csat_score: score };
        } else {
          replyText = buildCsatInvalidScoreMessage();
        }
      } else {
        const rawComment = content.trim();
        const csatComment = rawComment === '0' ? null : rawComment || null;
        await tx.$executeRawUnsafe(
          `UPDATE conversations
           SET csat_comment = $1,
               csat_stage = 'done'
           WHERE id = $2::uuid`,
          csatComment,
          conversationId,
        );
        replyText = buildCsatThankYouMessage();
        csatPayload = { csat_score: currentCsatScore ?? null, csat_comment: csatComment };
      }

      const replyRows = await tx.$queryRawUnsafe<
        [{ id: string; content: string; created_at: Date; sender_type: string }]
      >(
        `INSERT INTO messages (conversation_id, sender_type, content, content_type, is_internal, status)
         VALUES ($1::uuid, 'bot', $2, 'text', false, 'sent')
         RETURNING id, content, created_at, sender_type`,
        conversationId,
        replyText,
      );
      const botSavedReply = replyRows[0]!;

      const csatPhoneNumberId =
        getCredentialValue(channelCredentials, 'phoneNumberId', 'phone_number_id') ?? phoneNumberId;
      const csatAccessToken = getCredentialValue(channelCredentials, 'accessToken', 'access_token');
      if (csatPhoneNumberId && csatAccessToken) {
        await sendWhatsAppTextMessage({
          text: replyText,
          to: formattedPhone,
          phoneNumberId: csatPhoneNumberId,
          accessToken: csatAccessToken,
        });
      }

      await tx.$executeRawUnsafe(
        `UPDATE conversations
         SET last_message = $1,
             last_message_at = NOW()
         WHERE id = $2::uuid`,
        replyText.slice(0, 255),
        conversationId,
      );

      return {
        conversationId,
        isNewConversation: false,
        shouldAutoAssign: false,
        botTag: undefined,
        botOptionId: undefined,
        message: savedMessage,
        protocolNumber: null,
        protocolMessageId: null,
        protocolMessageContent: null,
        botMessageId: null,
        botMessageContent: null,
        botMessage: botSavedReply,
        contactId,
        contactName: contactRows[0]?.name ?? senderName,
        organizationId,
        outsideBusinessHours,
        csatHandled: true,
        csatPayload,
        refreshInactivityForAssignedConversation: false,
      };
    }

    const currentAssignedTo = currentConversation?.assigned_to ?? null;
    const currentBotStage = currentConversation?.bot_stage ?? null;
    let hasAssignedAgent = Boolean(currentAssignedTo);

    if (isActiveOutboundReturnFlow) {
      const preferredAgentId = currentConversation?.outbound_origin_agent_id ?? currentAssignedTo ?? null;
      let preferredAgentName: string | null = null;
      if (preferredAgentId) {
        const preferredAgentRows = await tx.$queryRawUnsafe<Array<{ name: string | null }>>(
          `SELECT name
           FROM users
           WHERE id = $1::uuid
           LIMIT 1`,
          preferredAgentId,
        );
        preferredAgentName = preferredAgentRows[0]?.name ?? null;
      }
      const selectedAgent = await findBestAvailableAgent(tx, preferredAgentId);
      const resolvedAssignedTo = selectedAgent?.user_id ?? null;
      hasAssignedAgent = Boolean(resolvedAssignedTo);

      if (resolvedAssignedTo !== currentAssignedTo) {
        await tx.$executeRawUnsafe(
          `UPDATE conversations
           SET assigned_to = $1::uuid,
               assigned_at = NOW()
           WHERE id = $2::uuid`,
          resolvedAssignedTo,
          conversationId,
        );
      }

      await tx.$executeRawUnsafe(
        `UPDATE conversations
         SET status = 'open',
             outbound_returned_at = NOW(),
             metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
         WHERE id = $1::uuid`,
        conversationId,
        JSON.stringify({
          active_outbound_returned: true,
          active_outbound_returned_at: new Date().toISOString(),
          active_outbound_origin_agent_id: preferredAgentId,
          active_outbound_origin_agent_name: preferredAgentName,
          active_outbound_received_by_agent_id: selectedAgent?.user_id ?? null,
          active_outbound_received_by_agent_name: selectedAgent?.name ?? null,
          active_outbound_replied_within_window: true,
        }),
      );

      if (selectedAgent?.user_id) {
        await tx.$executeRawUnsafe(
          `UPDATE agent_assignments
           SET last_assigned_at = NOW()
           WHERE user_id = $1::uuid`,
          selectedAgent.user_id,
        );
      }

      await syncActiveConversationCounters(tx, [currentAssignedTo, selectedAgent?.user_id ?? null]);
    }

    // Mensagem de cliente em conversa com agente atribuído deve sempre manter o fluxo humano.
    if (hasAssignedAgent) {
      await tx.$executeRawUnsafe(
        `UPDATE conversations
         SET last_message_at = NOW()
         WHERE id = $1::uuid`,
        conversationId,
      );
    }

    let botResponse: Awaited<ReturnType<typeof processBotMessage>> | null = null;
    if (!hasAssignedAgent && !isActiveOutboundReturnFlow) {
      const canProcessBot = isNewConversation || currentBotStage === 'waiting_choice';
      const skipBot = currentBotStage === 'done';
      if (!skipBot && canProcessBot) {
        botResponse = await processBotMessage(content, conversationId, isNewConversation, tx, false);
      }
    }

    const msgRows = await tx.$queryRawUnsafe<
      [{ id: string; content: string; created_at: Date; sender_type: string }]
    >(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, media_url, external_id, status, metadata)
       VALUES ($1::uuid, 'client', $2::uuid, $3, $4, $5, $6, 'delivered', $7::jsonb)
       RETURNING id, content, created_at, sender_type`,
      conversationId,
      contactId,
      content,
      contentType,
      externalMediaId,
      message.id,
      JSON.stringify(incomingMessageMetadata),
    );
    const savedMessage = msgRows[0]!;

    await tx.$executeRawUnsafe(
      `UPDATE conversations
       SET last_message = $1,
           last_message_at = NOW(),
           metadata = CASE
             WHEN $3::boolean THEN COALESCE(metadata, '{}'::jsonb) || '{"outside_business_hours": true}'::jsonb
             ELSE metadata
           END
       WHERE id = $2::uuid`,
      content.slice(0, 255),
      conversationId,
      outsideBusinessHours,
    );

    if (botResponse) {
      const botRows = await tx.$queryRawUnsafe<
        [{ id: string; content: string; created_at: Date; sender_type: string }]
      >(
        `INSERT INTO messages (conversation_id, sender_type, content, content_type, is_internal, status)
         VALUES ($1::uuid, 'bot', $2, 'text', false, 'sent')
         RETURNING id, content, created_at, sender_type`,
        conversationId,
        botResponse.text,
      );
      botSavedMessage = botRows[0]!;
      botMessageId = botSavedMessage.id;
      botMessageContent = botResponse.text;

      if (botResponse.type === 'choice') {
        await tx.$executeRawUnsafe(
          `UPDATE conversations
           SET status = 'open',
               last_message = $1,
               last_message_at = NOW()
           WHERE id = $2::uuid`,
          botResponse.text.slice(0, 255),
          conversationId,
        );
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE conversations
           SET status = 'bot',
               last_message = $1,
               last_message_at = NOW()
           WHERE id = $2::uuid`,
          botResponse.text.slice(0, 255),
          conversationId,
        );
      }
    }

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
      shouldAutoAssign: !isActiveOutboundReturnFlow && ((isNewConversation && !botResponse) || botResponse?.type === 'choice'),
      botTag: botResponse?.type === 'choice' ? (botResponse.option?.tag ?? undefined) : undefined,
      botOptionId: botResponse?.type === 'choice' ? (botResponse.option?.id ?? undefined) : undefined,
      message: savedMessage,
      protocolNumber,
      protocolMessageId,
      protocolMessageContent,
      botMessageId,
      botMessageContent,
      botMessage: botSavedMessage,
      contactId,
      contactName: contactRows[0]?.name ?? senderName,
      organizationId,
      outsideBusinessHours,
      csatHandled: false,
      csatPayload: null,
      refreshInactivityForAssignedConversation: hasAssignedAgent,
    };
  });

  if (result.refreshInactivityForAssignedConversation) {
    await cancelInactivityJobs(result.conversationId);
    const inactivitySettings = await getTenantInactivitySettings(tenantId);
    if (inactivitySettings.enabled && isOpen) {
      await scheduleInactivityCheck(
        result.conversationId,
        tenantId,
        schemaName,
        inactivitySettings.warningMinutes,
      );
    }
  }

  const io = getSocketServer();
  if (result.isNewConversation) {
    io.to(`tenant:${tenantId}`).emit('conversation:created', {
      conversationId: result.conversationId,
      contactName: result.contactName,
      organizationId: result.organizationId,
      outsideBusinessHours: result.outsideBusinessHours,
    });
  }
  io.to(`tenant:${tenantId}`).emit('conversation:new_message', {
    conversationId: result.conversationId,
    message: result.message,
    contact: {
      id: result.contactId,
      name: result.contactName,
    },
  });
  if (result.botMessage) {
    io.to(`tenant:${tenantId}`).emit('conversation:new_message', {
      conversationId: result.conversationId,
      message: result.botMessage,
      contact: {
        id: result.contactId,
        name: result.contactName,
      },
    });
  }
  if (result.csatHandled && result.csatPayload) {
    io.to(`tenant:${tenantId}`).emit('conversation:csat_updated', {
      conversationId: result.conversationId,
      ...result.csatPayload,
    });
  }

  if (!result.refreshInactivityForAssignedConversation) {
    await cancelInactivityJobs(result.conversationId);
    const inactivitySettings = await getTenantInactivitySettings(tenantId);
    if (inactivitySettings.enabled && isOpen) {
      await scheduleInactivityCheck(
        result.conversationId,
        tenantId,
        schemaName,
        inactivitySettings.warningMinutes,
      );
    }
  }

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

  if (result.botMessageId && result.botMessageContent) {
    await messageQueue.add('send', {
      messageId: result.botMessageId,
      conversationId: result.conversationId,
      tenantId,
      tenantSchema: schemaName,
      channelType: 'whatsapp',
      channelCredentials,
      content: result.botMessageContent,
      to: formattedPhone,
    });
  }

  if (result.shouldAutoAssign) {
    await autoAssignConversation(
      result.conversationId,
      tenantId,
      schemaName,
      prisma,
      io,
      undefined,
      result.botOptionId,
    );
  }

  // Notify assigned agent if conversation has one
  const convAssigned = await prisma.$queryRawUnsafe<[{ assigned_to: string | null; contact_name: string | null }]>(
    `SELECT c.assigned_to, ct.name AS contact_name
     FROM "${schemaName}".conversations c
     LEFT JOIN "${schemaName}".contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1::uuid LIMIT 1`,
    result.conversationId,
  );
  const assignedUserId = convAssigned[0]?.assigned_to ?? null;
  if (assignedUserId) {
    const clientName = convAssigned[0]?.contact_name ?? senderName;
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
  const firstError = status.errors?.[0];
  const firstErrorCode = typeof firstError?.code === 'number' ? firstError.code : null;
  const firstErrorTitle = typeof firstError?.title === 'string' ? firstError.title : null;
  const firstErrorMessage = typeof firstError?.message === 'string' ? firstError.message : null;
  const firstErrorDetails =
    typeof firstError?.error_data?.details === 'string'
      ? firstError.error_data.details
      : null;
  const requiresReengagementTemplate = status.status === 'failed' && firstErrorCode === 131047;

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
    whatsapp_error_code: firstErrorCode,
    whatsapp_error_title: firstErrorTitle,
    whatsapp_error_message: firstErrorMessage,
    whatsapp_error_details: firstErrorDetails,
    whatsapp_reengagement_required: requiresReengagementTemplate || null,
    whatsapp_reengagement_detected_at: requiresReengagementTemplate ? new Date().toISOString() : null,
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
      if (requiresReengagementTemplate) {
        await prisma.$executeRawUnsafe(
          `UPDATE "${tenant.schema_name}".conversations
           SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
           WHERE id = $1::uuid`,
          result[0].conversation_id,
          JSON.stringify({
            whatsapp_reengagement_required: true,
            whatsapp_reengagement_failed_at: new Date().toISOString(),
            whatsapp_reengagement_error_code: firstErrorCode,
            whatsapp_reengagement_error_title: firstErrorTitle,
            whatsapp_reengagement_error_message: firstErrorMessage,
            whatsapp_reengagement_error_details: firstErrorDetails,
          }),
        );

        const convRows = await prisma.$queryRawUnsafe<ConversationStatusRow[]>(
          `SELECT id, status
           FROM "${tenant.schema_name}".conversations
           WHERE id = $1::uuid
           LIMIT 1`,
          result[0].conversation_id,
        );

        if (convRows[0]?.status === 'active_outbound') {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "${tenant.schema_name}".messages (
               id,
               conversation_id,
               sender_type,
               content,
               content_type,
               is_internal,
               status,
               metadata
             )
             SELECT
               gen_random_uuid(),
               $1::uuid,
               'system',
               $2,
               'text',
               false,
               'failed',
               $3::jsonb
             WHERE NOT EXISTS (
               SELECT 1
               FROM "${tenant.schema_name}".messages m
               WHERE m.conversation_id = $1::uuid
                 AND m.sender_type = 'system'
                 AND m.metadata->>'delivery_failed_for_message_id' = $4
             )`,
            result[0].conversation_id,
            'Falha no envio ativo do WhatsApp: a janela de 24h expirou. Envie um template para reengajar o contato.',
            JSON.stringify({
              delivery_failed_for_message_id: result[0].id,
              delivery_failed_external_id: status.id,
              delivery_failed_error_code: firstErrorCode,
              delivery_failed_type: 'whatsapp_reengagement_required',
            }),
            result[0].id,
          );
        }
      }

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
        externalId: status.id,
        status: mappedStatus,
      });
      if (requiresReengagementTemplate) {
        io.to(`tenant:${tenant.id}`).emit('conversation:updated', {
          conversationId: result[0].conversation_id,
        });
      }
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
            try {
              await processStatusUpdate(app, status);
            } catch (err) {
              request.log.error({ err }, '[WhatsApp] Failed to process status update');
            }
          }
          continue;
        }

        if (!value.messages?.length) continue;

        for (const message of value.messages) {
          const contact = value.contacts?.[0];
          const senderName = contact?.profile.name ?? message.from;
          const senderPhone = message.from;
          const phoneNumberId = value.metadata.phone_number_id;

          try {
            await processIncomingMessage(app, {
              phoneNumberId,
              senderPhone,
              senderName,
              message,
              wabaId: entry.id,
            });
          } catch (err) {
            request.log.error({ err }, '[WhatsApp] Failed to process incoming message');
          }
        }
      }
    }
  });
}
