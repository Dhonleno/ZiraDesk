import { prisma } from '../../../config/database.js';
import type { Server } from 'socket.io';
import { decryptCredentials } from '../../../utils/crypto.js';
import type {
  ListConversationsQuery,
  ListMessagesQuery,
  SendMessageBody,
  UpdateConversationBody,
  CreateConversationBody,
} from './conversations.schema.js';
import {
  buildProtocolMessage,
  ensureConversationProtocolInfrastructure,
  generateConversationProtocol,
  quoteIdent,
} from './protocols.js';
import { ensureConversationTagsInfrastructure } from '../../admin/conversation-tags/conversation-tags.service.js';
import { ensureConversationCsatInfrastructure } from './csat.infrastructure.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

async function getSchemaName(tenantId?: string): Promise<string | null> {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  if (!tenant) throw new NotFoundError('Tenant não encontrado');
  return tenant.schemaName;
}

async function getSchemaPrefix(tenantId?: string): Promise<string> {
  const schemaName = await getSchemaName(tenantId);
  if (!schemaName) return '';
  return `${quoteIdent(schemaName)}.`;
}

async function ensureConversationHelpersInfrastructure(tenantId?: string): Promise<void> {
  const schemaPrefix = await getSchemaPrefix(tenantId);
  const conversationRef = `${schemaPrefix}conversations`;
  const usersRef = `${schemaPrefix}users`;
  const helpersRef = `${schemaPrefix}conversation_helpers`;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${helpersRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES ${conversationRef}(id) ON DELETE CASCADE,
      helper_user_id UUID REFERENCES ${usersRef}(id),
      requested_by UUID REFERENCES ${usersRef}(id),
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      UNIQUE(conversation_id, helper_user_id)
    )
  `);
}

interface ConversationRow {
  id: string;
  contact_id: string | null;
  organization_id: string | null;
  channel_id: string | null;
  channel_type: string;
  conversation_type: string;
  external_id: string | null;
  status: string;
  protocol_number: string | null;
  assigned_to: string | null;
  subject: string | null;
  last_message: string | null;
  last_message_at: Date | null;
  resolved_at: Date | null;
  csat_score: number | null;
  csat_comment: string | null;
  csat_sent_at: Date | null;
  csat_responded_at: Date | null;
  csat_stage: 'sent' | 'waiting_comment' | 'done' | null;
  created_at: Date;
  metadata: unknown;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  organization_name: string | null;
  assigned_name: string | null;
  channel_name: string | null;
  tags?: ConversationTagChip[];
}

interface ConversationTagChip {
  id: string;
  name: string;
  color: string;
}

function normalizeProtocolNumber(value: string | null | undefined): string | null {
  if (!value) return null;

  const compact = value.replace(/\s+/g, '').trim();
  if (!compact) return null;

  const upper = compact.toUpperCase();
  if (/^ZD-\d{6}-\d{6}$/.test(upper)) return upper;
  if (/^\d{6}-\d{6}$/.test(compact)) return `ZD-${compact}`;
  return compact;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  content: string;
  content_type: string;
  media_url: string | null;
  external_id: string | null;
  status: string;
  is_internal: boolean;
  created_at: Date;
  metadata: unknown;
}

interface MentionSourceMessageRow {
  id: string;
  content: string | null;
  content_type: string;
  media_url: string | null;
  external_id: string | null;
  sender_type: string;
  metadata: unknown;
  agent_name: string | null;
  contact_name: string | null;
}

interface MentionMetadata {
  message_id: string;
  sender_type: string;
  sender_label: string;
  content: string;
  content_type: string;
  external_id: string | null;
  media_id?: string | null;
  media_subtype?: string | null;
}

interface MessageMetadataPatch {
  filename?: string;
  mention?: MentionMetadata;
}

interface MessageCursorRow {
  id: string;
  created_at: Date;
}

interface MessageCountRow {
  count: bigint;
}

interface ConversationHelperRow {
  id: string;
  conversation_id: string;
  helper_user_id: string;
  helper_name: string | null;
  requested_by: string;
  requester_name: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'ended';
  created_at: Date;
  accepted_at: Date | null;
  ended_at: Date | null;
}

function isLegacySchemaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    (message.includes('column') && message.includes('does not exist')) ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

interface ListConversationSqlContext {
  whereSql: string;
  params: unknown[];
  limitPlaceholder: string;
  offsetPlaceholder: string;
}

function buildListConversationSqlContext(
  query: ListConversationsQuery,
  userId: string | undefined,
  searchColumn: string,
  contactColumn: string,
  outboundCondition: string,
  tagAssignmentsRef: string,
): ListConversationSqlContext {
  const { page, perPage, tab, sub_status, status, search, assigned_to_me, agent_id, contact_id, tag_id } = query;
  const offset = (page - 1) * perPage;
  const params: unknown[] = [];
  const conditions: string[] = [];

  const pushParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (tab === 'active') {
    conditions.push('c.assigned_to IS NOT NULL');
    conditions.push("c.status IN ('open', 'active_outbound')");

    if (assigned_to_me) {
      conditions.push(`c.assigned_to::text = ${pushParam(userId ?? null)}::text`);
    }
  } else if (tab === 'queue') {
    conditions.push('c.assigned_to IS NULL');
    conditions.push("c.status IN ('open', 'pending', 'bot')");
  } else if (tab === 'closed') {
    conditions.push("c.status IN ('resolved', 'closed')");

    if (sub_status === 'resolved') {
      conditions.push("c.status = 'resolved'");
    } else if (sub_status === 'closed') {
      conditions.push("c.status = 'closed'");
    } else if (sub_status === 'outbound') {
      conditions.push(outboundCondition);
    }
  } else if (status) {
    conditions.push(`c.status = ${pushParam(status)}::text`);
  }

  if (search) {
    conditions.push(`${searchColumn} ILIKE '%' || ${pushParam(search)}::text || '%'`);
  }

  if (agent_id) {
    conditions.push(`c.assigned_to = ${pushParam(agent_id)}::uuid`);
  }

  if (contact_id) {
    conditions.push(`${contactColumn} = ${pushParam(contact_id)}::uuid`);
  }

  if (tag_id) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM ${tagAssignmentsRef} cta2
      WHERE cta2.conversation_id = c.id
        AND cta2.tag_id = ${pushParam(tag_id)}::uuid
    )`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitPlaceholder = pushParam(perPage);
  const offsetPlaceholder = pushParam(offset);

  return {
    whereSql,
    params,
    limitPlaceholder,
    offsetPlaceholder,
  };
}

interface MessagePageResult {
  messages: MessageRow[];
  has_more: boolean;
  total: number;
}

interface ConversationCounts {
  active: number;
  mine: number;
  queue: number;
  closed: number;
}

function buildMentionContentPreview(content: string | null | undefined, contentType: string): string {
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

function buildMentionSenderLabel(message: MentionSourceMessageRow): string {
  if (message.sender_type === 'agent') return message.agent_name ?? 'Agente';
  if (message.sender_type === 'bot') return 'Bot';
  if (message.sender_type === 'system') return 'Sistema';
  return message.contact_name ?? 'Cliente';
}

function getMentionMediaId(message: MentionSourceMessageRow): string | null {
  if (message.media_url?.trim()) return message.media_url.trim();
  if (!message.metadata || typeof message.metadata !== 'object') return null;
  const mediaId = (message.metadata as Record<string, unknown>).media_id;
  return typeof mediaId === 'string' && mediaId.trim() ? mediaId.trim() : null;
}

function getMentionMediaSubtype(message: MentionSourceMessageRow): string | null {
  if (!message.metadata || typeof message.metadata !== 'object') return null;
  const mediaSubtype = (message.metadata as Record<string, unknown>).media_subtype;
  return typeof mediaSubtype === 'string' && mediaSubtype.trim() ? mediaSubtype.trim() : null;
}

export async function listConversations(query: ListConversationsQuery, userId?: string, tenantId?: string) {
  const schemaName = await getSchemaName(tenantId);
  const schemaPrefix = schemaName ? `${quoteIdent(schemaName)}.` : '';
  const conversationsRef = `${schemaPrefix}conversations`;
  const contactsRef = `${schemaPrefix}contacts`;
  const organizationsRef = `${schemaPrefix}organizations`;
  const usersRef = `${schemaPrefix}users`;
  const channelsRef = `${schemaPrefix}channels`;
  const clientsRef = `${schemaPrefix}clients`;
  const conversationTagsRef = `${schemaPrefix}conversation_tags`;
  const conversationTagAssignmentsRef = `${schemaPrefix}conversation_tag_assignments`;

  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  if (schemaName) {
    await ensureConversationTagsInfrastructure(schemaName);
  }

  const modernContext = buildListConversationSqlContext(
    query,
    userId,
    'ct.name',
    'c.contact_id',
    "c.conversation_type = 'outbound'",
    conversationTagAssignmentsRef,
  );

  try {
    const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
      `SELECT
         c.id, c.contact_id, c.organization_id, c.channel_id, c.channel_type, c.conversation_type, c.external_id,
         c.status, c.protocol_number, c.assigned_to, c.subject, c.last_message, c.last_message_at,
         c.resolved_at, c.csat_score, c.csat_comment, c.csat_sent_at, c.csat_responded_at, c.csat_stage,
         c.created_at, c.metadata,
         ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone, ct.whatsapp AS contact_whatsapp,
         o.name AS organization_name,
         u.name AS assigned_name,
         ch.name AS channel_name,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', ctag.id,
                 'name', ctag.name,
                 'color', ctag.color
               )
               ORDER BY ctag.sort_order ASC, ctag.name ASC
             )
             FROM ${conversationTagAssignmentsRef} cta
             JOIN ${conversationTagsRef} ctag ON ctag.id = cta.tag_id
             WHERE cta.conversation_id = c.id
               AND ctag.is_active = true
           ),
           '[]'::json
         ) AS tags
       FROM ${conversationsRef} c
       LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
       LEFT JOIN ${organizationsRef} o ON o.id = c.organization_id
       LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
       LEFT JOIN ${channelsRef} ch ON ch.id = c.channel_id
       ${modernContext.whereSql}
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT ${modernContext.limitPlaceholder} OFFSET ${modernContext.offsetPlaceholder}`,
      ...modernContext.params,
    );

    const countParams = modernContext.params.slice(0, -2);
    const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count
       FROM ${conversationsRef} c
       LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
       ${modernContext.whereSql}`,
      ...countParams,
    );

    const total = Number(countRows[0]?.count ?? 0);

    return {
      data: rows,
      meta: {
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.ceil(total / query.perPage),
      },
    };
  } catch (error) {
    if (!isLegacySchemaError(error)) throw error;

    const legacyContext = buildListConversationSqlContext(
    query,
    userId,
    'cl.name',
    'c.client_id',
    "COALESCE(c.metadata->>'type', 'inbound') = 'outbound'",
    conversationTagAssignmentsRef,
  );

    const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
      `SELECT
         c.id,
         c.client_id AS contact_id,
         NULL::uuid AS organization_id,
         c.channel_id,
         c.channel_type,
         COALESCE(c.metadata->>'type', 'inbound') AS conversation_type,
         c.external_id,
         c.status,
         NULL::text AS protocol_number,
         c.assigned_to,
         c.subject,
         c.last_message,
         c.last_message_at,
         c.resolved_at,
         c.csat_score,
         c.csat_comment,
         c.csat_sent_at,
         c.csat_responded_at,
         c.csat_stage,
         c.created_at,
         c.metadata,
         cl.name AS contact_name,
         cl.email AS contact_email,
         cl.phone AS contact_phone,
         cl.phone AS contact_whatsapp,
         NULL::text AS organization_name,
         u.name AS assigned_name,
         ch.name AS channel_name,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', ctag.id,
                 'name', ctag.name,
                 'color', ctag.color
               )
               ORDER BY ctag.sort_order ASC, ctag.name ASC
             )
             FROM ${conversationTagAssignmentsRef} cta
             JOIN ${conversationTagsRef} ctag ON ctag.id = cta.tag_id
             WHERE cta.conversation_id = c.id
               AND ctag.is_active = true
           ),
           '[]'::json
         ) AS tags
       FROM ${conversationsRef} c
       LEFT JOIN ${clientsRef} cl ON cl.id = c.client_id
       LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
       LEFT JOIN ${channelsRef} ch ON ch.id = c.channel_id
       ${legacyContext.whereSql}
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT ${legacyContext.limitPlaceholder} OFFSET ${legacyContext.offsetPlaceholder}`,
      ...legacyContext.params,
    );

    const countParams = legacyContext.params.slice(0, -2);
    const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count
       FROM ${conversationsRef} c
       LEFT JOIN ${clientsRef} cl ON cl.id = c.client_id
       ${legacyContext.whereSql}`,
      ...countParams,
    );

    const total = Number(countRows[0]?.count ?? 0);

    return {
      data: rows,
      meta: {
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.ceil(total / query.perPage),
      },
    };
  }
}

export async function getConversationCounts(userId?: string, tenantId?: string): Promise<ConversationCounts> {
  const schemaPrefix = await getSchemaPrefix(tenantId);
  const conversationRef = `${schemaPrefix}conversations`;

  const rows = await prisma.$queryRawUnsafe<Array<{
    active: bigint;
    mine: bigint;
    queue: bigint;
    closed: bigint;
  }>>(
    `SELECT
       COUNT(*) FILTER (
         WHERE assigned_to IS NOT NULL
           AND status IN ('open', 'active_outbound')
       ) AS active,
       COUNT(*) FILTER (
         WHERE assigned_to::text = $1::text
           AND status IN ('open', 'active_outbound')
       ) AS mine,
       COUNT(*) FILTER (
         WHERE assigned_to IS NULL
           AND status IN ('open', 'pending', 'bot')
       ) AS queue,
       COUNT(*) FILTER (
         WHERE status IN ('resolved', 'closed')
       ) AS closed
     FROM ${conversationRef}`,
    userId ?? null,
  );

  const counts = rows[0];
  return {
    active: Number(counts?.active ?? 0),
    mine: Number(counts?.mine ?? 0),
    queue: Number(counts?.queue ?? 0),
    closed: Number(counts?.closed ?? 0),
  };
}

export async function getConversationWithMessages(conversationId: string, tenantId?: string) {
  const schemaName = await getSchemaName(tenantId);
  const schemaPrefix = schemaName ? `${quoteIdent(schemaName)}.` : '';
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  if (schemaName) {
    await ensureConversationTagsInfrastructure(schemaName);
  }
  const conversationTagsRef = `${schemaPrefix}conversation_tags`;
  const conversationTagAssignmentsRef = `${schemaPrefix}conversation_tag_assignments`;
  const convRows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `SELECT
       c.id, c.contact_id, c.organization_id, c.channel_id, c.channel_type, c.conversation_type, c.external_id,
       c.status, c.protocol_number, c.assigned_to, c.subject, c.last_message, c.last_message_at,
       c.resolved_at, c.csat_score, c.csat_comment, c.csat_sent_at, c.csat_responded_at, c.csat_stage,
       c.created_at, c.metadata,
       ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone, ct.whatsapp AS contact_whatsapp,
       o.name AS organization_name,
       u.name AS assigned_name,
       ch.name AS channel_name,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', ctag.id,
               'name', ctag.name,
               'color', ctag.color
             )
             ORDER BY ctag.sort_order ASC, ctag.name ASC
           )
           FROM ${conversationTagAssignmentsRef} cta
           JOIN ${conversationTagsRef} ctag ON ctag.id = cta.tag_id
           WHERE cta.conversation_id = c.id
             AND ctag.is_active = true
         ),
         '[]'::json
       ) AS tags
     FROM ${schemaPrefix}conversations c
     LEFT JOIN ${schemaPrefix}contacts ct ON ct.id = c.contact_id
     LEFT JOIN ${schemaPrefix}organizations o ON o.id = c.organization_id
     LEFT JOIN ${schemaPrefix}users u ON u.id = c.assigned_to
     LEFT JOIN ${schemaPrefix}channels ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );

  if (!convRows[0]) throw new NotFoundError('Conversa não encontrada');

  const messages = await prisma.$queryRawUnsafe<MessageRow[]>(
    `SELECT id, conversation_id, sender_type, sender_id, content, content_type,
            media_url, external_id, status, is_internal, created_at, metadata
     FROM ${schemaPrefix}messages
     WHERE conversation_id = $1::uuid
     ORDER BY created_at ASC`,
    conversationId,
  );

  return { conversation: convRows[0], messages };
}

export async function listConversationMessages(
  conversationId: string,
  query: ListMessagesQuery,
  tenantId?: string,
): Promise<MessagePageResult> {
  const schemaPrefix = await getSchemaPrefix(tenantId);
  const limit = Math.max(1, query.per_page);
  const fetchLimit = limit + 1;
  let rows: MessageRow[] = [];

  if (query.before) {
    const cursorRows = await prisma.$queryRawUnsafe<MessageCursorRow[]>(
      `SELECT id, created_at
       FROM ${schemaPrefix}messages
       WHERE id = $1::uuid AND conversation_id = $2::uuid
       LIMIT 1`,
      query.before,
      conversationId,
    );
    const cursor = cursorRows[0];

    if (cursor) {
      rows = await prisma.$queryRawUnsafe<MessageRow[]>(
        `SELECT id, conversation_id, sender_type, sender_id, content, content_type,
                media_url, external_id, status, is_internal, created_at, metadata
         FROM ${schemaPrefix}messages
         WHERE conversation_id = $1::uuid
           AND (
             created_at < $2
             OR (created_at = $2 AND id < $3::uuid)
           )
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        conversationId,
        cursor.created_at,
        cursor.id,
        fetchLimit,
      );
    }
  } else {
    rows = await prisma.$queryRawUnsafe<MessageRow[]>(
      `SELECT id, conversation_id, sender_type, sender_id, content, content_type,
              media_url, external_id, status, is_internal, created_at, metadata
       FROM ${schemaPrefix}messages
       WHERE conversation_id = $1::uuid
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      conversationId,
      fetchLimit,
    );
  }

  const has_more = rows.length > limit;
  const slice = has_more ? rows.slice(0, limit) : rows;
  const messages = slice.reverse();

  const totalRows = await prisma.$queryRawUnsafe<MessageCountRow[]>(
    `SELECT COUNT(*) AS count
     FROM ${schemaPrefix}messages
     WHERE conversation_id = $1::uuid`,
    conversationId,
  );
  const total = Number(totalRows[0]?.count ?? 0);

  return { messages, has_more, total };
}

export interface SendMessageResult {
  message: MessageRow;
  channelType: string;
  channelId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  channelCredentials: string | null;
  mediaId: string | null;
  mediaType: 'image' | 'audio' | 'video' | 'document' | null;
  mediaFilename: string | null;
  replyToExternalId: string | null;
  replyToMessageId: string | null;
}

export interface MessageDispatchPayload {
  messageId: string;
  protocolNumber?: string;
  content: string;
  channelType: string;
  channelCredentials: Record<string, string> | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface CreateConversationResult {
  conversation: ConversationRow;
  protocolDispatches: MessageDispatchPayload[];
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: SendMessageBody,
): Promise<SendMessageResult> {
  const convRows = await prisma.$queryRawUnsafe<
    [{
      id: string;
      channel_id: string | null;
      channel_type: string;
      contact_id: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      channel_credentials: string | null;
    }]
  >(
    `SELECT c.id, c.channel_id, c.channel_type, c.contact_id,
            ct.phone AS contact_phone, ct.email AS contact_email,
            ch.credentials AS channel_credentials
     FROM conversations c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  if (!convRows[0]) throw new NotFoundError('Conversa não encontrada');
  const conv = convRows[0];

  const contentType =
    body.media_id && body.media_type
      ? body.media_type
      : body.contentType ?? 'text';

  const content = body.content?.trim() ?? '';
  const mediaId = body.media_id ?? null;
  const mediaFilename = body.media_filename ?? null;
  const mentionMessageId = body.mention_message_id ?? null;
  const metadataPatch: MessageMetadataPatch = {};

  if (mediaFilename) {
    metadataPatch.filename = mediaFilename;
  }

  let replyToExternalId: string | null = null;
  let replyToMessageId: string | null = null;

  if (mentionMessageId) {
    const mentionRows = await prisma.$queryRawUnsafe<MentionSourceMessageRow[]>(
      `SELECT
         m.id,
         m.content,
         m.content_type,
         m.media_url,
         m.external_id,
         m.sender_type,
         m.metadata,
         u.name AS agent_name,
         ct.name AS contact_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE m.id = $1::uuid
         AND m.conversation_id = $2::uuid
       LIMIT 1`,
      mentionMessageId,
      conversationId,
    );
    const mentionSource = mentionRows[0];
    if (!mentionSource) throw new NotFoundError('Mensagem mencionada não encontrada');

    metadataPatch.mention = {
      message_id: mentionSource.id,
      sender_type: mentionSource.sender_type,
      sender_label: buildMentionSenderLabel(mentionSource),
      content: buildMentionContentPreview(mentionSource.content, mentionSource.content_type),
      content_type: mentionSource.content_type,
      external_id: mentionSource.external_id,
      media_id: getMentionMediaId(mentionSource),
      media_subtype: getMentionMediaSubtype(mentionSource),
    };

    replyToMessageId = mentionSource.id;
    replyToExternalId = mentionSource.external_id;
  }

  const msgRows = await prisma.$queryRawUnsafe<MessageRow[]>(
    `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, media_url, is_internal, metadata)
     VALUES ($1::uuid, 'agent', $2::uuid, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    conversationId,
    senderId,
    content,
    contentType,
    mediaId,
    body.isInternal ?? false,
    JSON.stringify(metadataPatch),
  );

  const message = msgRows[0]!;
  const mediaPreviewLabel: Record<'image' | 'audio' | 'video' | 'document', string> = {
    image: '[Imagem]',
    audio: '[Áudio]',
    video: '[Vídeo]',
    document: '[Documento]',
  };
  const lastMessagePreview =
    content.slice(0, 255) ||
    (contentType !== 'text' ? mediaPreviewLabel[contentType as keyof typeof mediaPreviewLabel] : '[Mensagem]');

  await prisma.$executeRawUnsafe(
    `UPDATE conversations
     SET last_message = $1,
         last_message_at = NOW(),
         status = CASE
           WHEN status = 'open' AND assigned_to IS NULL THEN 'pending'
           ELSE status
         END
     WHERE id = $2::uuid`,
    lastMessagePreview,
    conversationId,
  );

  return {
    message,
    channelType: conv.channel_type,
    channelId: conv.channel_id,
    contactPhone: conv.contact_phone,
    contactEmail: conv.contact_email,
    channelCredentials: conv.channel_credentials,
    mediaId,
    mediaType: mediaId ? (contentType as 'image' | 'audio' | 'video' | 'document') : null,
    mediaFilename,
    replyToExternalId,
    replyToMessageId,
  };
}

export async function createConversation(
  data: CreateConversationBody,
  userId: string,
  tenantId?: string,
): Promise<CreateConversationResult> {
  await ensureConversationProtocolInfrastructure(prisma, await getSchemaName(tenantId));

  const contactCheck = await prisma.$queryRawUnsafe<
    [{ id: string; phone: string | null; whatsapp: string | null; email: string | null }]
  >(
    `SELECT id, phone, whatsapp, email FROM contacts WHERE id = $1::uuid LIMIT 1`,
    data.contact_id,
  );
  if (!contactCheck[0]) throw new NotFoundError('Contato não encontrado');

  const channelCheck = await prisma.$queryRawUnsafe<
    [{ id: string; type: string; credentials: string | object | null }]
  >(
    `SELECT id, type, credentials FROM channels WHERE id = $1::uuid AND status = 'active' LIMIT 1`,
    data.channel_id,
  );
  if (!channelCheck[0]) throw new NotFoundError('Canal ativo não encontrado');

  const conversationType = data.type ?? 'inbound';
  const initialMessage = data.initial_message?.trim() ?? '';
  const initialStatus = conversationType === 'outbound' ? 'active_outbound' : 'open';
  const metadata = {
    type: conversationType,
  };

  const protocolNumber = await generateConversationProtocol(prisma, await getSchemaName(tenantId));
  const convRows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `INSERT INTO conversations (contact_id, organization_id, channel_id, channel_type, conversation_type, status, protocol_number, assigned_to, subject, metadata)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::uuid, $9, $10::jsonb)
     RETURNING *`,
    data.contact_id,
    data.organization_id ?? null,
    data.channel_id,
    channelCheck[0].type,
    conversationType,
    initialStatus,
    protocolNumber,
    userId,
    data.subject ?? null,
    JSON.stringify(metadata),
  );
  const conversation = convRows[0]!;
  const protocolMessage = buildProtocolMessage(protocolNumber);
  const protocolMessageRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO messages (conversation_id, sender_type, content, content_type, is_internal)
     VALUES ($1::uuid, 'system', $2, 'text', false)
     RETURNING id`,
    conversation.id,
    protocolMessage,
  );
  let lastMessagePreview = protocolMessage.slice(0, 255);
  let initialMessageRows: Array<{ id: string }> = [];

  if (initialMessage) {
    initialMessageRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type)
       VALUES ($1::uuid, 'agent', $2::uuid, $3, 'text')
       RETURNING id`,
      conversation.id,
      userId,
      initialMessage,
    );
    lastMessagePreview = initialMessage.slice(0, 255);
  }

  await prisma.$executeRawUnsafe(
    `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2::uuid`,
    lastMessagePreview,
    conversation.id,
  );

  const protocolDispatches: MessageDispatchPayload[] = [];
  if (channelCheck[0].type === 'whatsapp') {
    const channelCredentials = channelCheck[0].credentials ? decryptCredentials(channelCheck[0].credentials) : null;
    protocolDispatches.push({
      messageId: protocolMessageRows[0]!.id,
      protocolNumber,
      content: protocolMessage,
      channelType: channelCheck[0].type,
      channelCredentials,
      contactPhone: contactCheck[0].whatsapp ?? contactCheck[0].phone,
      contactEmail: contactCheck[0].email,
    });

    if (initialMessageRows[0]) {
      protocolDispatches.push({
        messageId: initialMessageRows[0].id,
        content: initialMessage,
        channelType: channelCheck[0].type,
        channelCredentials,
        contactPhone: contactCheck[0].whatsapp ?? contactCheck[0].phone,
        contactEmail: contactCheck[0].email,
      });
    }
  }

  return { conversation, protocolDispatches };
}

export async function assignConversation(conversationId: string, assignToUserId: string, assignedBy: string) {
  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET assigned_to = $1::uuid,
         status = 'open'
     WHERE id = $2::uuid
     RETURNING *`,
    assignToUserId,
    conversationId,
  );
  if (!rows[0]) throw new NotFoundError('Conversa não encontrada');

  const agents = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM users WHERE id = $1::uuid LIMIT 1`,
    assignToUserId,
  );
  const agentName = agents[0]?.name ?? 'Agente';

  await prisma.$executeRawUnsafe(
    `INSERT INTO messages (id, conversation_id, sender_type, content, content_type, is_internal, created_at)
     VALUES (gen_random_uuid(), $1::uuid, 'system', $2, 'text', false, NOW())`,
    conversationId,
    `Atendimento assumido por ${agentName}`,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'conversation.assigned', 'conversation', $2::uuid, $3::jsonb)`,
    assignedBy,
    conversationId,
    JSON.stringify({ assigned_to: assignToUserId, status: 'open' }),
  );

  return rows[0];
}

export async function transferConversation(
  conversationId: string,
  assignToUserId: string,
  transferredBy: string,
  reason?: string,
) {
  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET assigned_to = $1::uuid
     WHERE id = $2::uuid
     RETURNING *`,
    assignToUserId,
    conversationId,
  );
  if (!rows[0]) throw new NotFoundError('Conversa não encontrada');

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'conversation.transferred', 'conversation', $2::uuid, $3::jsonb)`,
    transferredBy,
    conversationId,
    JSON.stringify({ assigned_to: assignToUserId, reason: reason ?? null }),
  );

  return rows[0];
}

export async function updateConversation(
  conversationId: string,
  body: UpdateConversationBody,
  actorUserId: string,
) {
  await ensureConversationCsatInfrastructure(prisma);

  const convCheck = await prisma.$queryRawUnsafe<[{ id: string }]>(
    `SELECT id FROM conversations WHERE id = $1::uuid LIMIT 1`,
    conversationId,
  );
  if (!convCheck[0]) throw new NotFoundError('Conversa não encontrada');

  const hasAssignedTo = 'assignedTo' in body;
  const assignedToValue = body.assignedTo ?? null;
  const hasCsatScore = 'csat_score' in body;
  const hasCsatComment = 'csat_comment' in body;

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET
       status = COALESCE($1::text, status),
       assigned_to = CASE WHEN $2 THEN $3::uuid ELSE assigned_to END,
       csat_score = CASE WHEN $5::boolean THEN $6::integer ELSE csat_score END,
       csat_comment = CASE WHEN $7::boolean THEN $8::text ELSE csat_comment END,
       resolved_at = CASE
         WHEN $1 = 'resolved' THEN NOW()
         WHEN $1 IS NOT NULL AND $1 != 'resolved' THEN NULL
         ELSE resolved_at
       END
     WHERE id = $4::uuid
     RETURNING *`,
    body.status ?? null,
    hasAssignedTo,
    assignedToValue,
    conversationId,
    hasCsatScore,
    body.csat_score ?? null,
    hasCsatComment,
    body.csat_comment ?? null,
  );

  if (body.status === 'resolved') {
    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
       VALUES ($1::uuid, 'conversation.resolved', 'conversation', $2::uuid, $3::jsonb)`,
      actorUserId,
      conversationId,
      JSON.stringify({
        status: 'resolved',
        csat_score: body.csat_score ?? null,
        csat_comment: body.csat_comment ?? null,
      }),
    );
  }

  return rows[0]!;
}

export async function requestHelp(
  conversationId: string,
  helperUserId: string,
  requesterId: string,
  tenantId: string | undefined,
  io: Server,
): Promise<ConversationHelperRow> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  const conversationRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    assigned_to: string | null;
    protocol_number: string | null;
  }>>(
    `SELECT id, assigned_to, protocol_number
     FROM ${schemaPrefix}conversations
     WHERE id = $1::uuid
     LIMIT 1`,
    conversationId,
  );

  const conversation = conversationRows[0];
  if (!conversation) throw new NotFoundError('Conversa nao encontrada');
  if (!conversation.assigned_to || conversation.assigned_to !== requesterId) {
    throw new ForbiddenError('Apenas o agente responsavel pode solicitar ajuda');
  }

  if (helperUserId === requesterId) {
    throw new ConflictError('Nao e possivel solicitar ajuda para si mesmo');
  }

  const helperRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
  }>>(
    `SELECT u.id, u.name
     FROM ${schemaPrefix}users u
     JOIN ${schemaPrefix}agent_assignments aa ON aa.user_id = u.id
     WHERE u.id = $1::uuid
       AND u.status = 'active'
       AND u.role IN ('owner', 'admin', 'agent')
       AND aa.status = 'online'
       AND aa.is_available = true
     LIMIT 1`,
    helperUserId,
  );

  const helper = helperRows[0];
  if (!helper) throw new ConflictError('Agente de apoio indisponivel');

  const requesterRows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT id, name
     FROM ${schemaPrefix}users
     WHERE id = $1::uuid
     LIMIT 1`,
    requesterId,
  );
  const requester = requesterRows[0];

  const rows = await prisma.$queryRawUnsafe<ConversationHelperRow[]>(
    `INSERT INTO ${schemaPrefix}conversation_helpers (
       conversation_id, helper_user_id, requested_by, status, created_at, accepted_at, ended_at
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'pending', NOW(), NULL, NULL)
     ON CONFLICT (conversation_id, helper_user_id)
     DO UPDATE SET
       requested_by = EXCLUDED.requested_by,
       status = 'pending',
       created_at = NOW(),
       accepted_at = NULL,
       ended_at = NULL
     RETURNING id, conversation_id, helper_user_id, requested_by, status, created_at, accepted_at, ended_at,
       NULL::text AS helper_name,
       NULL::text AS requester_name`,
    conversationId,
    helperUserId,
    requesterId,
  );

  io.to(`agent:${helperUserId}`).emit('help:requested', {
    conversationId,
    requestedBy: {
      id: requesterId,
      name: requester?.name ?? 'Agente',
    },
    protocol: normalizeProtocolNumber(conversation.protocol_number),
  });

  io.to(`agent:${helperUserId}`).emit('notification:new', {
    type: 'help.requested',
    title: 'Pedido de ajuda',
    message: `${requester?.name ?? 'Um agente'} precisa de ajuda`,
    conversationId,
    createdAt: new Date().toISOString(),
  });

  return rows[0]!;
}

export async function acceptHelp(
  conversationId: string,
  helperUserId: string,
  tenantId: string | undefined,
  io: Server,
): Promise<ConversationHelperRow> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  const rows = await prisma.$queryRawUnsafe<ConversationHelperRow[]>(
    `UPDATE ${schemaPrefix}conversation_helpers
     SET status = 'accepted',
         accepted_at = NOW(),
         ended_at = NULL
     WHERE conversation_id = $1::uuid
       AND helper_user_id = $2::uuid
       AND status IN ('pending', 'accepted')
     RETURNING id, conversation_id, helper_user_id, requested_by, status, created_at, accepted_at, ended_at,
       NULL::text AS helper_name,
       NULL::text AS requester_name`,
    conversationId,
    helperUserId,
  );

  const accepted = rows[0];
  if (!accepted) throw new NotFoundError('Pedido de ajuda nao encontrado');

  const detailsRows = await prisma.$queryRawUnsafe<Array<{
    helper_name: string | null;
    requester_name: string | null;
    requested_by: string;
  }>>(
    `SELECT h.requested_by, helper.name AS helper_name, requester.name AS requester_name
     FROM ${schemaPrefix}conversation_helpers h
     LEFT JOIN ${schemaPrefix}users helper ON helper.id = h.helper_user_id
     LEFT JOIN ${schemaPrefix}users requester ON requester.id = h.requested_by
     WHERE h.conversation_id = $1::uuid
       AND h.helper_user_id = $2::uuid
     LIMIT 1`,
    conversationId,
    helperUserId,
  );

  const details = detailsRows[0];
  io.to(`agent:${details?.requested_by ?? accepted.requested_by}`).emit('help:accepted', {
    conversationId,
    helper: {
      id: helperUserId,
      name: details?.helper_name ?? 'Agente',
    },
  });

  return {
    ...accepted,
    helper_name: details?.helper_name ?? null,
    requester_name: details?.requester_name ?? null,
  };
}

export async function declineHelp(
  conversationId: string,
  helperUserId: string,
  tenantId: string | undefined,
  io: Server,
): Promise<ConversationHelperRow> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  const rows = await prisma.$queryRawUnsafe<ConversationHelperRow[]>(
    `UPDATE ${schemaPrefix}conversation_helpers
     SET status = 'declined',
         ended_at = NOW()
     WHERE conversation_id = $1::uuid
       AND helper_user_id = $2::uuid
       AND status IN ('pending', 'accepted')
     RETURNING id, conversation_id, helper_user_id, requested_by, status, created_at, accepted_at, ended_at,
       NULL::text AS helper_name,
       NULL::text AS requester_name`,
    conversationId,
    helperUserId,
  );

  const declined = rows[0];
  if (!declined) throw new NotFoundError('Pedido de ajuda nao encontrado');

  io.to(`agent:${declined.requested_by}`).emit('help:declined', {
    conversationId,
    helperId: helperUserId,
  });

  return declined;
}

export async function endHelp(
  conversationId: string,
  userId: string,
  tenantId: string | undefined,
): Promise<{ updated: number }> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE ${schemaPrefix}conversation_helpers
     SET status = 'ended',
         ended_at = NOW()
     WHERE conversation_id = $1::uuid
       AND status IN ('pending', 'accepted')
       AND (helper_user_id = $2::uuid OR requested_by = $2::uuid)
     RETURNING id`,
    conversationId,
    userId,
  );

  return { updated: rows.length };
}

export async function getConversationHelpers(
  conversationId: string,
  tenantId?: string,
): Promise<ConversationHelperRow[]> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  return prisma.$queryRawUnsafe<ConversationHelperRow[]>(
    `SELECT
       h.id,
       h.conversation_id,
       h.helper_user_id,
       helper.name AS helper_name,
       h.requested_by,
       requester.name AS requester_name,
       h.status,
       h.created_at,
       h.accepted_at,
       h.ended_at
     FROM ${schemaPrefix}conversation_helpers h
     LEFT JOIN ${schemaPrefix}users helper ON helper.id = h.helper_user_id
     LEFT JOIN ${schemaPrefix}users requester ON requester.id = h.requested_by
     WHERE h.conversation_id = $1::uuid
     ORDER BY h.created_at DESC`,
    conversationId,
  );
}
