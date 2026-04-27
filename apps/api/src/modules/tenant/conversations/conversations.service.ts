import { prisma } from '../../../config/database.js';
import type { ListConversationsQuery, SendMessageBody, UpdateConversationBody } from './conversations.schema.js';

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

export async function listConversations(query: ListConversationsQuery) {
  const { page, perPage, status, search } = query;
  const offset = (page - 1) * perPage;

  const statusParam = status ?? null;
  const searchParam = search ?? null;

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
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT $3 OFFSET $4`,
    statusParam,
    searchParam,
    perPage,
    offset,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE ($1::text IS NULL OR c.status = $1)
       AND ($2::text IS NULL OR cl.name ILIKE '%' || $2 || '%')`,
    statusParam,
    searchParam,
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

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: SendMessageBody,
) {
  const convCheck = await prisma.$queryRawUnsafe<[{ id: string }]>(
    `SELECT id FROM conversations WHERE id = $1 LIMIT 1`,
    conversationId,
  );
  if (!convCheck[0]) throw new NotFoundError('Conversa não encontrada');

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
         status = CASE WHEN status = 'open' THEN 'in_service' ELSE status END
     WHERE id = $2`,
    body.content.slice(0, 255),
    conversationId,
  );

  return message;
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
