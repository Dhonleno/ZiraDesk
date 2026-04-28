import { prisma } from '../../../config/database.js';
import type {
  ListConversationsQuery,
  SendMessageBody,
  UpdateConversationBody,
  CreateConversationBody,
} from './conversations.schema.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

interface ConversationRow {
  id: string;
  client_id: string | null;
  channel_id: string | null;
  channel_type: string;
  external_id: string | null;
  status: string;
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

export async function listConversations(query: ListConversationsQuery, userId?: string) {
  const { page, perPage, status, search, assigned_to_me } = query;
  const offset = (page - 1) * perPage;

  const statusParam = status ?? null;
  const searchParam = search ?? null;
  const assignedToParam = assigned_to_me ? (userId ?? null) : null;

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `SELECT
       c.id, c.client_id, c.channel_id, c.channel_type, c.external_id,
       c.status, c.assigned_to, c.subject, c.last_message, c.last_message_at,
       c.resolved_at, c.created_at, c.metadata,
       cl.name AS client_name, cl.email AS client_email, cl.phone AS client_phone,
       u.name AS assigned_name,
       ch.name AS channel_name
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN users u ON u.id = c.assigned_to
     LEFT JOIN channels ch ON ch.id = c.channel_id
     WHERE ($1::text IS NULL OR c.status = $1)
       AND ($2::text IS NULL OR cl.name ILIKE '%' || $2 || '%')
       AND ($5::uuid IS NULL OR c.assigned_to = $5::uuid)
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT $3 OFFSET $4`,
    statusParam,
    searchParam,
    perPage,
    offset,
    assignedToParam,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE ($1::text IS NULL OR c.status = $1)
       AND ($2::text IS NULL OR cl.name ILIKE '%' || $2 || '%')
       AND ($3::uuid IS NULL OR c.assigned_to = $3::uuid)`,
    statusParam,
    searchParam,
    assignedToParam,
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

export async function getConversationWithMessages(conversationId: string) {
  const convRows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `SELECT
       c.id, c.client_id, c.channel_id, c.channel_type, c.external_id,
       c.status, c.assigned_to, c.subject, c.last_message, c.last_message_at,
       c.resolved_at, c.created_at, c.metadata,
       cl.name AS client_name, cl.email AS client_email, cl.phone AS client_phone,
       u.name AS assigned_name,
       ch.name AS channel_name
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN users u ON u.id = c.assigned_to
     LEFT JOIN channels ch ON ch.id = c.channel_id
     WHERE c.id = $1
     LIMIT 1`,
    conversationId,
  );

  if (!convRows[0]) throw new NotFoundError('Conversa não encontrada');

  const messages = await prisma.$queryRawUnsafe<MessageRow[]>(
    `SELECT id, conversation_id, sender_type, sender_id, content, content_type,
            media_url, external_id, status, is_internal, created_at, metadata
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    conversationId,
  );

  return { conversation: convRows[0], messages };
}

export interface SendMessageResult {
  message: MessageRow;
  channelType: string;
  channelId: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  channelCredentials: string | null;
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
     WHERE c.id = $1
     LIMIT 1`,
    conversationId,
  );
  if (!convRows[0]) throw new NotFoundError('Conversa não encontrada');
  const conv = convRows[0];

  const msgRows = await prisma.$queryRawUnsafe<MessageRow[]>(
    `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type)
     VALUES ($1, 'agent', $2, $3, $4)
     RETURNING *`,
    conversationId,
    senderId,
    body.content,
    body.contentType,
  );

  const message = msgRows[0]!;

  await prisma.$executeRawUnsafe(
    `UPDATE conversations
     SET last_message = $1,
         last_message_at = NOW(),
         status = CASE WHEN status = 'open' THEN 'pending' ELSE status END
     WHERE id = $2`,
    body.content.slice(0, 255),
    conversationId,
  );

  return {
    message,
    channelType: conv.channel_type,
    channelId: conv.channel_id,
    clientPhone: conv.client_phone,
    clientEmail: conv.client_email,
    channelCredentials: conv.channel_credentials,
  };
}

export async function createConversation(data: CreateConversationBody, userId: string) {
  const clientCheck = await prisma.$queryRawUnsafe<[{ id: string }]>(
    `SELECT id FROM clients WHERE id = $1 LIMIT 1`,
    data.client_id,
  );
  if (!clientCheck[0]) throw new NotFoundError('Cliente não encontrado');

  const channelCheck = await prisma.$queryRawUnsafe<[{ id: string; type: string }]>(
    `SELECT id, type FROM channels WHERE id = $1 AND status = 'active' LIMIT 1`,
    data.channel_id,
  );
  if (!channelCheck[0]) throw new NotFoundError('Canal ativo não encontrado');

  const convRows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `INSERT INTO conversations (client_id, channel_id, channel_type, status, assigned_to, subject)
     VALUES ($1, $2, $3, 'open', $4::uuid, $5)
     RETURNING *`,
    data.client_id,
    data.channel_id,
    channelCheck[0].type,
    userId,
    data.subject ?? null,
  );
  const conversation = convRows[0]!;

  if (data.initial_message) {
    await prisma.$queryRawUnsafe(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type)
       VALUES ($1, 'agent', $2::uuid, $3, 'text')`,
      conversation.id,
      userId,
      data.initial_message,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2`,
      data.initial_message.slice(0, 255),
      conversation.id,
    );
  }

  return conversation;
}

export async function assignConversation(conversationId: string, assignToUserId: string) {
  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET assigned_to = $1::uuid
     WHERE id = $2
     RETURNING *`,
    assignToUserId,
    conversationId,
  );
  if (!rows[0]) throw new NotFoundError('Conversa não encontrada');
  return rows[0];
}

export async function transferConversation(conversationId: string, assignToUserId: string) {
  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET assigned_to = $1::uuid
     WHERE id = $2
     RETURNING *`,
    assignToUserId,
    conversationId,
  );
  if (!rows[0]) throw new NotFoundError('Conversa não encontrada');
  return rows[0];
}

export async function updateConversation(
  conversationId: string,
  body: UpdateConversationBody,
) {
  const convCheck = await prisma.$queryRawUnsafe<[{ id: string }]>(
    `SELECT id FROM conversations WHERE id = $1 LIMIT 1`,
    conversationId,
  );
  if (!convCheck[0]) throw new NotFoundError('Conversa não encontrada');

  const hasAssignedTo = 'assignedTo' in body;
  const assignedToValue = body.assignedTo ?? null;

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET
       status = COALESCE($1::text, status),
       assigned_to = CASE WHEN $2 THEN $3::uuid ELSE assigned_to END,
       resolved_at = CASE
         WHEN $1 = 'resolved' THEN NOW()
         WHEN $1 IS NOT NULL AND $1 != 'resolved' THEN NULL
         ELSE resolved_at
       END
     WHERE id = $4
     RETURNING *`,
    body.status ?? null,
    hasAssignedTo,
    assignedToValue,
    conversationId,
  );

  return rows[0]!;
}
