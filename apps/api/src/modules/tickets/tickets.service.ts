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
  contact_id:       string | null;
  organization_id:  string | null;
  conversation_id:  string | null;
  source_conversation_id: string | null;
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
  contact_name:     string | null;
  organization_name: string | null;
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

interface TicketEventRow {
  id: string;
  ticket_id: string;
  user_id: string | null;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  user_name: string | null;
  avatar_url: string | null;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function toPgArray(arr: string[]): string {
  if (!arr.length) return '{}';
  return '{' + arr.map(t => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',') + '}';
}

type RawExecutor = typeof prisma;
let ticketInfraEnsured = false;

async function ensureTicketInfrastructure(): Promise<void> {
  if (ticketInfraEnsured) return;

  await prisma.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ticket_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id),
      event_type VARCHAR(50) NOT NULL,
      old_value TEXT,
      new_value TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket
    ON ticket_events(ticket_id)
  `);

  ticketInfraEnsured = true;
}

async function logTicketEvent(
  ticketId: string,
  userId: string,
  eventType: string,
  oldValue?: string | null,
  newValue?: string | null,
  metadata?: Record<string, unknown>,
  tx: RawExecutor = prisma,
): Promise<TicketEventRow | null> {
  await ensureTicketInfrastructure();

  const rows = await tx.$queryRawUnsafe<TicketEventRow[]>(
    `INSERT INTO ticket_events
      (ticket_id, user_id, event_type, old_value, new_value, metadata)
     VALUES
      ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
     RETURNING
      id, ticket_id, user_id, event_type, old_value, new_value, metadata, created_at,
      NULL::text AS user_name, NULL::text AS avatar_url`,
    ticketId,
    userId,
    eventType,
    oldValue ?? null,
    newValue ?? null,
    JSON.stringify(metadata ?? {}),
  );
  return rows[0] ?? null;
}

function emitTicketEvent(tenantId: string, ticketId: string, event: TicketEventRow, userName?: string | null) {
  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:event', {
      ticketId,
      event: {
        ...event,
        user_name: userName ?? event.user_name ?? null,
      },
    });
  } catch {
    // socket não inicializado em testes
  }
}

const SORT_COLUMNS: Record<string, string> = {
  created_at: 't.created_at',
  updated_at: 't.updated_at',
  due_date:   't.due_date',
  priority:   `CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END`,
};

const BASE_SELECT = `
  SELECT
    t.id, t.contact_id, t.organization_id, t.conversation_id, t.source_conversation_id, t.title, t.description,
    t.status, t.priority, t.category, t.assigned_to, t.resolved_at,
    t.due_date, t.tags, t.custom_fields, t.created_at, t.updated_at,
    u.name        AS assignee_name,
    u.avatar_url  AS assignee_avatar,
    ct.name       AS contact_name,
    o.name        AS organization_name
  FROM tickets t
  LEFT JOIN users         u  ON u.id  = t.assigned_to
  LEFT JOIN contacts      ct ON ct.id = t.contact_id
  LEFT JOIN organizations o  ON o.id  = t.organization_id`;

/* ── listTickets ─────────────────────────────────────────────────────────── */
export async function listTickets(query: ListTicketsQuery) {
  await ensureTicketInfrastructure();
  const { page, per_page, search, status, priority, assigned_to, contact_id, organization_id, category, sort_by, sort_order } = query;
  const offset = (page - 1) * per_page;

  const searchParam       = search          ?? null;
  const statusParam       = status          ?? null;
  const priorityParam     = priority        ?? null;
  const assignedParam     = assigned_to     ?? null;
  const contactParam      = contact_id      ?? null;
  const organizationParam = organization_id ?? null;
  const categoryParam     = category        ?? null;

  const sortCol = SORT_COLUMNS[sort_by] ?? 't.created_at';
  const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

  const where = `
    WHERE ($1::text IS NULL OR t.title ILIKE '%' || $1 || '%' OR t.description ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR t.status         = $2)
      AND ($3::text IS NULL OR t.priority       = $3)
      AND ($4::uuid IS NULL OR t.assigned_to    = $4::uuid)
      AND ($5::uuid IS NULL OR t.contact_id     = $5::uuid)
      AND ($6::uuid IS NULL OR t.organization_id = $6::uuid)
      AND ($7::text IS NULL OR t.category       = $7)`;

  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `${BASE_SELECT}${where}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $8 OFFSET $9`,
    searchParam, statusParam, priorityParam, assignedParam, contactParam, organizationParam, categoryParam,
    per_page, offset,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM tickets t${where}`,
    searchParam, statusParam, priorityParam, assignedParam, contactParam, organizationParam, categoryParam,
  );

  const total = Number(countRows[0]?.count ?? 0);
  return {
    data: rows,
    meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
  };
}

/* ── getTicket ───────────────────────────────────────────────────────────── */
export async function getTicket(id: string) {
  await ensureTicketInfrastructure();
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
  await ensureTicketInfrastructure();
  const tagsLiteral = toPgArray(data.tags ?? []);

  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `INSERT INTO tickets
       (contact_id, organization_id, conversation_id, source_conversation_id, title, description, status, priority, category,
        assigned_to, due_date, tags)
     VALUES
       ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::uuid, $11::timestamptz, $12::text[])
     RETURNING
       id, contact_id, organization_id, conversation_id, source_conversation_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS contact_name,  NULL AS organization_name`,
    data.contact_id      ?? null,
    data.organization_id ?? null,
    data.conversation_id ?? null,
    data.source_conversation_id ?? null,
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

  const createdEvent = await logTicketEvent(
    ticket.id,
    createdBy,
    'created',
    null,
    null,
    { status: ticket.status, priority: ticket.priority },
  );
  if (createdEvent) emitTicketEvent(tenantId, ticket.id, createdEvent);

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:created', { ticket });
  } catch { /* socket não inicializado em testes */ }

  return ticket;
}

/* ── updateTicket ────────────────────────────────────────────────────────── */
export async function updateTicket(id: string, data: UpdateTicketInput, updatedBy: string, tenantId: string) {
  await ensureTicketInfrastructure();
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
       id, contact_id, organization_id, conversation_id, source_conversation_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS contact_name,  NULL AS organization_name`,
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

  if (old.status !== ticket.status) {
    const statusEvent = await logTicketEvent(id, updatedBy, 'status_changed', old.status, ticket.status);
    if (statusEvent) emitTicketEvent(tenantId, id, statusEvent);
  }

  if (old.priority !== ticket.priority) {
    const priorityEvent = await logTicketEvent(id, updatedBy, 'priority_changed', old.priority, ticket.priority);
    if (priorityEvent) emitTicketEvent(tenantId, id, priorityEvent);
  }

  if (old.assigned_to !== ticket.assigned_to) {
    let assigneeName: string | null = null;
    if (ticket.assigned_to) {
      const assigneeRows = await prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
        `SELECT name FROM users WHERE id = $1::uuid LIMIT 1`,
        ticket.assigned_to,
      );
      assigneeName = assigneeRows[0]?.name ?? null;
    }
    const assignedEvent = await logTicketEvent(
      id,
      updatedBy,
      'assigned',
      old.assignee_name ?? null,
      assigneeName,
      { old_assigned_to: old.assigned_to, new_assigned_to: ticket.assigned_to },
    );
    if (assignedEvent) emitTicketEvent(tenantId, id, assignedEvent);
  }

  const oldTags = new Set(old.tags ?? []);
  const newTags = new Set(ticket.tags ?? []);
  const addedTags = [...newTags].filter((tag) => !oldTags.has(tag));
  const removedTags = [...oldTags].filter((tag) => !newTags.has(tag));

  for (const tag of addedTags) {
    const tagAddedEvent = await logTicketEvent(id, updatedBy, 'tag_added', null, tag);
    if (tagAddedEvent) emitTicketEvent(tenantId, id, tagAddedEvent);
  }

  for (const tag of removedTags) {
    const tagRemovedEvent = await logTicketEvent(id, updatedBy, 'tag_removed', tag, null);
    if (tagRemovedEvent) emitTicketEvent(tenantId, id, tagRemovedEvent);
  }

  if (old.status !== 'resolved' && ticket.status === 'resolved') {
    const resolvedEvent = await logTicketEvent(id, updatedBy, 'resolved', null, null);
    if (resolvedEvent) emitTicketEvent(tenantId, id, resolvedEvent);
  }

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
  await ensureTicketInfrastructure();
  const previous = await getTicket(id);
  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `UPDATE tickets SET assigned_to = $1::uuid, updated_at = NOW()
     WHERE id = $2::uuid
     RETURNING
       id, contact_id, organization_id, conversation_id, source_conversation_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS contact_name,  NULL AS organization_name`,
    userId, id,
  );

  if (!rows[0]) throw new NotFoundError('Ticket');
  const ticket = rows[0];

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'ticket.assigned', 'ticket', $2::uuid, $3::jsonb)`,
    assignedBy, id, JSON.stringify({ assigned_to: userId }),
  );

  const assigneeRows = await prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
    `SELECT name FROM users WHERE id = $1::uuid LIMIT 1`,
    userId,
  );
  const assigneeName = assigneeRows[0]?.name ?? null;
  const assignedEvent = await logTicketEvent(
    id,
    assignedBy,
    'assigned',
    previous.assignee_name ?? null,
    assigneeName,
    { old_assigned_to: previous.assigned_to, new_assigned_to: userId },
  );
  if (assignedEvent) emitTicketEvent(tenantId, id, assignedEvent, assigneeName);

  try {
    const io = getSocketServer();
    io.to(`tenant:${tenantId}`).emit('ticket:updated', { ticket });
    io.to(`agent:${userId}`).emit('ticket:assigned', { ticket });
    io.to(`agent:${userId}`).emit('notification:new', {
      id,
      type: 'ticket_assigned',
      title: 'Ticket atribuído',
      message: `Você recebeu o ticket "${ticket.title}".`,
      href: `/tickets/${id}`,
    });
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
  const ticket = await getTicket(ticketId);

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

  const commentEvent = await logTicketEvent(
    ticketId,
    userId,
    'comment_added',
    null,
    null,
    { comment_id: comment.id, is_internal: comment.is_internal },
  );
  if (commentEvent) emitTicketEvent(tenantId, ticketId, commentEvent);

  try {
    const io = getSocketServer();
    io.to(`tenant:${tenantId}`).emit('ticket:comment_added', { comment });
    if (ticket.assigned_to && ticket.assigned_to !== userId) {
      io.to(`agent:${ticket.assigned_to}`).emit('notification:new', {
        id: comment.id,
        type: 'ticket_comment',
        title: 'Novo comentário',
        message: `Novo comentário em "${ticket.title}".`,
        href: `/tickets/${ticketId}`,
      });
    }
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

/* ── getTicketTimeline ───────────────────────────────────────────────────── */
export async function getTicketTimeline(ticketId: string) {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<TicketEventRow[]>(
    `SELECT
       te.id,
       te.ticket_id,
       te.user_id,
       te.event_type,
       te.old_value,
       te.new_value,
       te.metadata,
       te.created_at,
       u.name AS user_name,
       u.avatar_url
     FROM ticket_events te
     LEFT JOIN users u ON u.id = te.user_id
     WHERE te.ticket_id = $1::uuid
     ORDER BY te.created_at ASC`,
    ticketId,
  );

  return rows;
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
