import { prisma } from '../../../config/database.js';
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

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
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

interface ConversationRow {
  id: string;
  client_id: string | null;
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
  created_at: Date;
  metadata: unknown;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  assigned_name: string | null;
  channel_name: string | null;
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

interface MessageCursorRow {
  id: string;
  created_at: Date;
}

interface MessageCountRow {
  count: bigint;
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

export async function listConversations(query: ListConversationsQuery, userId?: string, _tenantId?: string) {
  const { page, perPage, tab, sub_status, status, search, assigned_to_me, client_id } = query;
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
      conditions.push(`c.assigned_to = ${pushParam(userId ?? null)}::uuid`);
    }
  } else if (tab === 'queue') {
    conditions.push('c.assigned_to IS NULL');
    conditions.push("c.status IN ('open', 'pending')");
  } else if (tab === 'closed') {
    conditions.push("c.status IN ('resolved', 'closed')");

    if (sub_status === 'resolved') {
      conditions.push("c.status = 'resolved'");
    } else if (sub_status === 'closed') {
      conditions.push("c.status = 'closed'");
    } else if (sub_status === 'outbound') {
      conditions.push("c.conversation_type = 'outbound'");
    }
  } else if (status) {
    conditions.push(`c.status = ${pushParam(status)}::text`);
  }

  if (search) {
    conditions.push(`cl.name ILIKE '%' || ${pushParam(search)}::text || '%'`);
  }

  if (client_id) {
    conditions.push(`c.client_id = ${pushParam(client_id)}::uuid`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `SELECT
       c.id, c.client_id, c.channel_id, c.channel_type, c.conversation_type, c.external_id,
       c.status, c.protocol_number, c.assigned_to, c.subject, c.last_message, c.last_message_at,
       c.resolved_at, c.created_at, c.metadata,
       cl.name AS client_name, cl.email AS client_email, cl.phone AS client_phone,
       u.name AS assigned_name,
       ch.name AS channel_name
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN users u ON u.id = c.assigned_to
     LEFT JOIN channels ch ON ch.id = c.channel_id
     ${whereSql}
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT ${pushParam(perPage)} OFFSET ${pushParam(offset)}`,
    ...params,
  );

  const countParams = params.slice(0, -2);
  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
     ${whereSql}`,
    ...countParams,
  );

  const total = Number(countRows[0]?.count ?? 0);

  return {
    data: rows,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  };
}

export async function getConversationCounts(userId?: string, _tenantId?: string): Promise<ConversationCounts> {
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
         WHERE assigned_to = $1::uuid
           AND status IN ('open', 'active_outbound')
       ) AS mine,
       COUNT(*) FILTER (
         WHERE assigned_to IS NULL
           AND status IN ('open', 'pending')
       ) AS queue,
       COUNT(*) FILTER (
         WHERE status IN ('resolved', 'closed')
       ) AS closed
     FROM conversations`,
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
  const schemaPrefix = await getSchemaPrefix(tenantId);
  const convRows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `SELECT
       c.id, c.client_id, c.channel_id, c.channel_type, c.conversation_type, c.external_id,
       c.status, c.protocol_number, c.assigned_to, c.subject, c.last_message, c.last_message_at,
       c.resolved_at, c.created_at, c.metadata,
       cl.name AS client_name, cl.email AS client_email, cl.phone AS client_phone,
       u.name AS assigned_name,
       ch.name AS channel_name
     FROM ${schemaPrefix}conversations c
     LEFT JOIN ${schemaPrefix}clients cl ON cl.id = c.client_id
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
  clientPhone: string | null;
  clientEmail: string | null;
  channelCredentials: string | null;
  mediaId: string | null;
  mediaType: 'image' | 'audio' | 'video' | 'document' | null;
  mediaFilename: string | null;
}

export interface MessageDispatchPayload {
  messageId: string;
  protocolNumber?: string;
  content: string;
  channelType: string;
  channelCredentials: Record<string, string> | null;
  clientPhone: string | null;
  clientEmail: string | null;
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
      client_id: string | null;
      client_phone: string | null;
      client_email: string | null;
      channel_credentials: string | null;
    }]
  >(
    `SELECT c.id, c.channel_id, c.channel_type, c.client_id,
            cl.phone AS client_phone, cl.email AS client_email,
            ch.credentials AS channel_credentials
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
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
  const metadataPatch = mediaFilename ? JSON.stringify({ filename: mediaFilename }) : '{}';

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
    metadataPatch,
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
    clientPhone: conv.client_phone,
    clientEmail: conv.client_email,
    channelCredentials: conv.channel_credentials,
    mediaId,
    mediaType: mediaId ? (contentType as 'image' | 'audio' | 'video' | 'document') : null,
    mediaFilename,
  };
}

export async function createConversation(
  data: CreateConversationBody,
  userId: string,
  tenantId?: string,
): Promise<CreateConversationResult> {
  await ensureConversationProtocolInfrastructure(prisma, await getSchemaName(tenantId));

  const clientCheck = await prisma.$queryRawUnsafe<
    [{ id: string; phone: string | null; email: string | null }]
  >(
    `SELECT id, phone, email FROM clients WHERE id = $1::uuid LIMIT 1`,
    data.client_id,
  );
  if (!clientCheck[0]) throw new NotFoundError('Cliente não encontrado');

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
    `INSERT INTO conversations (client_id, channel_id, channel_type, conversation_type, status, protocol_number, assigned_to, subject, metadata)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9::jsonb)
     RETURNING *`,
    data.client_id,
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
      clientPhone: clientCheck[0].phone,
      clientEmail: clientCheck[0].email,
    });

    if (initialMessageRows[0]) {
      protocolDispatches.push({
        messageId: initialMessageRows[0].id,
        content: initialMessage,
        channelType: channelCheck[0].type,
        channelCredentials,
        clientPhone: clientCheck[0].phone,
        clientEmail: clientCheck[0].email,
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
  const convCheck = await prisma.$queryRawUnsafe<[{ id: string; metadata: unknown }]>(
    `SELECT id, metadata FROM conversations WHERE id = $1::uuid LIMIT 1`,
    conversationId,
  );
  if (!convCheck[0]) throw new NotFoundError('Conversa não encontrada');

  const hasAssignedTo = 'assignedTo' in body;
  const assignedToValue = body.assignedTo ?? null;
  const shouldPersistCsat =
    body.status === 'resolved' && (body.csat_score !== undefined || body.csat_comment !== undefined);
  const metadataBase =
    typeof convCheck[0].metadata === 'object' && convCheck[0].metadata !== null
      ? (convCheck[0].metadata as Record<string, unknown>)
      : {};
  const metadataPatch = shouldPersistCsat
    ? {
        ...metadataBase,
        csat_score: body.csat_score ?? null,
        csat_comment: body.csat_comment ?? null,
      }
    : null;

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET
       status = COALESCE($1::text, status),
       assigned_to = CASE WHEN $2 THEN $3::uuid ELSE assigned_to END,
       metadata = COALESCE($5::jsonb, metadata),
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
    metadataPatch ? JSON.stringify(metadataPatch) : null,
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
