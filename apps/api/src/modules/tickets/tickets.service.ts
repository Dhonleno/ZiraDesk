import { prisma } from '../../config/database.js';
import { getSocketServer } from '../../socket/index.js';
import type {
  CreateTicketInput,
  UpdateTicketInput,
  ListTicketsQuery,
  CreateCommentInput,
} from './tickets.schema.js';

/* ── Custom errors ───────────────────────────────────────────────────────── */
export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Acesso negado') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/* ── Row interfaces ──────────────────────────────────────────────────────── */
interface TicketRow {
  id:               string;
  client_id:        string | null;
  conversation_id:  string | null;
  title:            string;
  description:      string | null;
  status:           string;
  priority:         string;
  category:         string | null;
  assigned_to:      string | null;
  resolved_at:      Date | null;
  due_date:         Date | null;
  tags:             string[];
  custom_fields:    unknown;
  created_at:       Date;
  updated_at:       Date;
  assignee_name:    string | null;
  assignee_avatar:  string | null;
  client_name:      string | null;
  client_email:     string | null;
}

interface CommentRow {
  id:          string;
  ticket_id:   string;
  user_id:     string;
  content:     string;
  is_internal: boolean;
  created_at:  Date;
  author_name:   string | null;
  author_avatar: string | null;
}

interface StatsRow {
  total_tickets:           bigint;
  open_tickets:            bigint;
  in_progress_tickets:     bigint;
  waiting_tickets:         bigint;
  resolved_today:          bigint;
  priority_low:            bigint;
  priority_medium:         bigint;
  priority_high:           bigint;
  priority_urgent:         bigint;
  avg_resolution_time_hours: number | null;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function toPgArray(arr: string[]): string {
  if (!arr.length) return '{}';
  return '{' + arr.map(t => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',') + '}';
}

const SORT_COLUMNS: Record<string, string> = {
  created_at: 't.created_at',
  updated_at: 't.updated_at',
  due_date:   't.due_date',
  priority:   `CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END`,
};

const BASE_SELECT = `
  SELECT
    t.id, t.client_id, t.conversation_id, t.title, t.description,
    t.status, t.priority, t.category, t.assigned_to, t.resolved_at,
    t.due_date, t.tags, t.custom_fields, t.created_at, t.updated_at,
    u.name        AS assignee_name,
    u.avatar_url  AS assignee_avatar,
    c.name        AS client_name,
    c.email       AS client_email
  FROM tickets t
  LEFT JOIN users   u ON u.id = t.assigned_to
  LEFT JOIN clients c ON c.id = t.client_id`;

/* ── listTickets ─────────────────────────────────────────────────────────── */
export async function listTickets(query: ListTicketsQuery) {
  const { page, per_page, search, status, priority, assigned_to, client_id, category, sort_by, sort_order } = query;
  const offset = (page - 1) * per_page;

  const searchParam     = search      ?? null;
  const statusParam     = status      ?? null;
  const priorityParam   = priority    ?? null;
  const assignedParam   = assigned_to ?? null;
  const clientParam     = client_id   ?? null;
  const categoryParam   = category    ?? null;

  const sortCol = SORT_COLUMNS[sort_by] ?? 't.created_at';
  const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

  const where = `
    WHERE ($1::text IS NULL OR t.title ILIKE '%' || $1 || '%' OR t.description ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR t.status    = $2)
      AND ($3::text IS NULL OR t.priority  = $3)
      AND ($4::uuid IS NULL OR t.assigned_to = $4::uuid)
      AND ($5::uuid IS NULL OR t.client_id   = $5::uuid)
      AND ($6::text IS NULL OR t.category  = $6)`;

  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `${BASE_SELECT}${where}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $7 OFFSET $8`,
    searchParam, statusParam, priorityParam, assignedParam, clientParam, categoryParam,
    per_page, offset,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM tickets t${where}`,
    searchParam, statusParam, priorityParam, assignedParam, clientParam, categoryParam,
  );

  const total = Number(countRows[0]?.count ?? 0);
  return {
    data: rows,
    meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
  };
}

/* ── getTicket ───────────────────────────────────────────────────────────── */
export async function getTicket(id: string) {
  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `${BASE_SELECT}
     WHERE t.id = $1::uuid
     LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Ticket');
  return rows[0];
}

/* ── createTicket ────────────────────────────────────────────────────────── */
export async function createTicket(data: CreateTicketInput, createdBy: string, tenantId: string) {
  const tagsLiteral = toPgArray(data.tags ?? []);

  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `INSERT INTO tickets
       (client_id, conversation_id, title, description, status, priority, category,
        assigned_to, due_date, tags)
     VALUES
       ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid, $9::timestamptz, $10::text[])
     RETURNING
       id, client_id, conversation_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS client_name,   NULL AS client_email`,
    data.client_id       ?? null,
    data.conversation_id ?? null,
    data.title,
    data.description     ?? null,
    data.status,
    data.priority,
    data.category        ?? null,
    data.assigned_to     ?? null,
    data.due_date        ?? null,
    tagsLiteral,
  );

  const ticket = rows[0]!;

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'ticket.created', 'ticket', $2::uuid, $3::jsonb)`,
    createdBy, ticket.id, JSON.stringify(ticket),
  );

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:created', { ticket });
  } catch { /* socket não inicializado em testes */ }

  return ticket;
}

/* ── updateTicket ────────────────────────────────────────────────────────── */
export async function updateTicket(id: string, data: UpdateTicketInput, updatedBy: string, tenantId: string) {
  const old = await getTicket(id);

  const newStatus    = data.status    ?? old.status;
  const resolvedAt   =
    newStatus === 'resolved' && old.status !== 'resolved' ? 'NOW()' :
    newStatus !== 'resolved' && old.status === 'resolved' ? 'NULL'  : null;

  const tagsLiteral  = data.tags !== undefined ? toPgArray(data.tags) : null;

  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `UPDATE tickets SET
       title           = COALESCE($1,        title),
       description     = COALESCE($2,        description),
       status          = COALESCE($3,        status),
       priority        = COALESCE($4,        priority),
       category        = COALESCE($5,        category),
       assigned_to     = COALESCE($6::uuid,  assigned_to),
       due_date        = COALESCE($7::timestamptz, due_date),
       tags            = COALESCE($8::text[], tags),
       resolved_at     = ${resolvedAt === 'NOW()' ? 'NOW()' : resolvedAt === 'NULL' ? 'NULL' : 'resolved_at'},
       updated_at      = NOW()
     WHERE id = $9::uuid
     RETURNING
       id, client_id, conversation_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS client_name,   NULL AS client_email`,
    data.title          ?? null,
    data.description    ?? null,
    data.status         ?? null,
    data.priority       ?? null,
    data.category       ?? null,
    data.assigned_to    ?? null,
    data.due_date       ?? null,
    tagsLiteral,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Ticket');
  const ticket = rows[0];

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'ticket.updated', 'ticket', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy, id, JSON.stringify(old), JSON.stringify(ticket),
  );

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:updated', { ticket });
  } catch { /* socket não inicializado em testes */ }

  return ticket;
}

/* ── deleteTicket ────────────────────────────────────────────────────────── */
export async function deleteTicket(id: string, deletedBy: string, tenantId: string) {
  const old = await getTicket(id);

  await prisma.$executeRawUnsafe(
    `UPDATE tickets SET status = 'closed', updated_at = NOW() WHERE id = $1::uuid`,
    id,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data)
     VALUES ($1::uuid, 'ticket.deleted', 'ticket', $2::uuid, $3::jsonb)`,
    deletedBy, id, JSON.stringify(old),
  );

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:updated', { ticket: { ...old, status: 'closed' } });
  } catch { /* socket não inicializado em testes */ }

  return { ...old, status: 'closed' };
}

/* ── assignTicket ────────────────────────────────────────────────────────── */
export async function assignTicket(id: string, userId: string, assignedBy: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `UPDATE tickets SET assigned_to = $1::uuid, updated_at = NOW()
     WHERE id = $2::uuid
     RETURNING
       id, client_id, conversation_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS client_name,   NULL AS client_email`,
    userId, id,
  );

  if (!rows[0]) throw new NotFoundError('Ticket');
  const ticket = rows[0];

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'ticket.assigned', 'ticket', $2::uuid, $3::jsonb)`,
    assignedBy, id, JSON.stringify({ assigned_to: userId }),
  );

  try {
    const io = getSocketServer();
    io.to(`tenant:${tenantId}`).emit('ticket:updated', { ticket });
    io.to(`agent:${userId}`).emit('ticket:assigned', { ticket });
  } catch { /* socket não inicializado em testes */ }

  return ticket;
}

/* ── listComments ────────────────────────────────────────────────────────── */
export async function listComments(ticketId: string) {
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<CommentRow[]>(
    `SELECT
       tc.id, tc.ticket_id, tc.user_id, tc.content, tc.is_internal, tc.created_at,
       u.name       AS author_name,
       u.avatar_url AS author_avatar
     FROM ticket_comments tc
     LEFT JOIN users u ON u.id = tc.user_id
     WHERE tc.ticket_id = $1::uuid
     ORDER BY tc.created_at ASC`,
    ticketId,
  );

  return rows;
}

/* ── addComment ──────────────────────────────────────────────────────────── */
export async function addComment(ticketId: string, data: CreateCommentInput, userId: string, tenantId: string) {
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<CommentRow[]>(
    `INSERT INTO ticket_comments (ticket_id, user_id, content, is_internal)
     VALUES ($1::uuid, $2::uuid, $3, $4)
     RETURNING
       id, ticket_id, user_id, content, is_internal, created_at,
       NULL AS author_name, NULL AS author_avatar`,
    ticketId, userId, data.content, data.is_internal,
  );

  const comment = rows[0]!;

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'ticket.comment_added', 'ticket_comment', $2::uuid, $3::jsonb)`,
    userId, comment.id, JSON.stringify(comment),
  );

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:comment_added', { comment });
  } catch { /* socket não inicializado em testes */ }

  return comment;
}

/* ── deleteComment ───────────────────────────────────────────────────────── */
export async function deleteComment(commentId: string, userId: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<CommentRow[]>(
    `SELECT id, ticket_id, user_id, content, is_internal, created_at,
            NULL AS author_name, NULL AS author_avatar
     FROM ticket_comments
     WHERE id = $1::uuid LIMIT 1`,
    commentId,
  );

  if (!rows[0]) throw new NotFoundError('Comentário');
  const comment = rows[0];

  if (comment.user_id !== userId) throw new ForbiddenError('Você não pode excluir este comentário');

  await prisma.$executeRawUnsafe(
    `DELETE FROM ticket_comments WHERE id = $1::uuid`,
    commentId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data)
     VALUES ($1::uuid, 'ticket.comment_deleted', 'ticket_comment', $2::uuid, $3::jsonb)`,
    userId, commentId, JSON.stringify(comment),
  );

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:comment_deleted', { commentId, ticketId: comment.ticket_id });
  } catch { /* socket não inicializado em testes */ }

  return { deleted: true };
}

/* ── getStats ────────────────────────────────────────────────────────────── */
export async function getStats() {
  const rows = await prisma.$queryRawUnsafe<StatsRow[]>(
    `SELECT
       COUNT(*)                                                                AS total_tickets,
       COUNT(*) FILTER (WHERE status = 'open')                                AS open_tickets,
       COUNT(*) FILTER (WHERE status = 'in_progress')                         AS in_progress_tickets,
       COUNT(*) FILTER (WHERE status = 'waiting')                             AS waiting_tickets,
       COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at::date = CURRENT_DATE) AS resolved_today,
       COUNT(*) FILTER (WHERE priority = 'low')                               AS priority_low,
       COUNT(*) FILTER (WHERE priority = 'medium')                            AS priority_medium,
       COUNT(*) FILTER (WHERE priority = 'high')                              AS priority_high,
       COUNT(*) FILTER (WHERE priority = 'urgent')                            AS priority_urgent,
       AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)
         FILTER (WHERE resolved_at IS NOT NULL)                               AS avg_resolution_time_hours
     FROM tickets`,
  );

  const r = rows[0]!;
  return {
    total_tickets:            Number(r.total_tickets),
    open_tickets:             Number(r.open_tickets),
    in_progress_tickets:      Number(r.in_progress_tickets),
    waiting_tickets:          Number(r.waiting_tickets),
    resolved_today:           Number(r.resolved_today),
    by_priority: {
      low:    Number(r.priority_low),
      medium: Number(r.priority_medium),
      high:   Number(r.priority_high),
      urgent: Number(r.priority_urgent),
    },
    avg_resolution_time_hours: r.avg_resolution_time_hours !== null ? Number(r.avg_resolution_time_hours) : null,
  };
}
