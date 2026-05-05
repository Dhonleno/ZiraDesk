import { prisma } from '../../config/database.js';
import { getSocketServer } from '../../socket/index.js';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  CreateTicketInput,
  UpdateTicketInput,
  ListTicketsQuery,
  CreateCommentInput,
  UpdateChecklistItemInput,
  CreateTimeEntryInput,
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
  type_id:          string | null;
  source:           string;
  email_message_id: string | null;
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
  type_name:        string | null;
  type_icon:        string | null;
  type_color:       string | null;
}

interface CommentRow {
  id:          string;
  ticket_id:   string;
  user_id:     string | null;
  contact_id:  string | null;
  source:      string;
  content:     string;
  is_internal: boolean;
  created_at:  Date;
  author_name:   string | null;
  author_avatar: string | null;
}

interface TicketAttachmentRow {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  user_id: string | null;
  filename: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: Date;
}

interface TicketChecklistRow {
  id: string;
  ticket_id: string;
  title: string;
  is_done: boolean;
  done_by: string | null;
  done_at: Date | null;
  sort_order: number;
  created_at: Date;
  done_by_name: string | null;
}

interface TicketTimeEntryRow {
  id: string;
  ticket_id: string;
  user_id: string;
  description: string | null;
  minutes: number;
  worked_at: Date;
  created_at: Date;
  user_name: string | null;
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

const ATTACHMENTS_BASE_DIR = path.resolve(process.cwd(), 'public', 'uploads', 'tickets');
const ALLOWED_ATTACHMENT_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024;

function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).trim();
  const normalized = base.replace(/[^\w.\-()\s]/g, '_').replace(/\s+/g, '_');
  return normalized || 'arquivo';
}

async function ensureAttachmentDir(ticketId: string): Promise<string> {
  const dir = path.join(ATTACHMENTS_BASE_DIR, ticketId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function ensurePathInside(baseDir: string, targetPath: string): void {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedBase)) {
    throw new ForbiddenError('Caminho de arquivo inválido');
  }
}

type RawExecutor = typeof prisma;
let ticketInfraEnsured = false;

async function ensureTicketInfrastructure(): Promise<void> {
  if (ticketInfraEnsured) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ticket_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(80) NOT NULL,
      icon VARCHAR(20) NOT NULL DEFAULT '🎫',
      color VARCHAR(7) NOT NULL DEFAULT '#00C9A7',
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_types_name_unique
    ON ticket_types (LOWER(name))
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS email_message_id VARCHAR(500)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_email_message_id
    ON tickets(email_message_id)
    WHERE email_message_id IS NOT NULL
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS type_id UUID REFERENCES ticket_types(id) ON DELETE SET NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tickets_type_id
    ON tickets(type_id)
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

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
      comment_id UUID REFERENCES ticket_comments(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id),
      filename VARCHAR(255) NOT NULL,
      file_url VARCHAR(500) NOT NULL,
      file_size INTEGER,
      mime_type VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket
    ON ticket_attachments(ticket_id)
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ticket_comments
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'agent'
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ticket_comments
    ALTER COLUMN user_id DROP NOT NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ticket_checklists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      is_done BOOLEAN DEFAULT false,
      done_by UUID REFERENCES users(id),
      done_at TIMESTAMPTZ,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ticket_checklists_ticket
    ON ticket_checklists(ticket_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ticket_time_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id),
      description VARCHAR(300),
      minutes INTEGER NOT NULL CHECK (minutes > 0),
      worked_at DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_time_entries_ticket
    ON ticket_time_entries(ticket_id)
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
    t.id, t.contact_id, t.organization_id, t.conversation_id, t.source_conversation_id, t.type_id, t.source, t.email_message_id, t.title, t.description,
    t.status, t.priority, t.category, t.assigned_to, t.resolved_at,
    t.due_date, t.tags, t.custom_fields, t.created_at, t.updated_at,
    u.name        AS assignee_name,
    u.avatar_url  AS assignee_avatar,
    ct.name       AS contact_name,
    o.name        AS organization_name,
    tt.name       AS type_name,
    tt.icon       AS type_icon,
    tt.color      AS type_color
  FROM tickets t
  LEFT JOIN users         u  ON u.id  = t.assigned_to
  LEFT JOIN contacts      ct ON ct.id = t.contact_id
  LEFT JOIN organizations o  ON o.id  = t.organization_id
  LEFT JOIN ticket_types  tt ON tt.id = t.type_id`;

/* ── listTickets ─────────────────────────────────────────────────────────── */
export async function listTickets(query: ListTicketsQuery) {
  await ensureTicketInfrastructure();
  const { page, per_page, search, status, priority, assigned_to, source, contact_id, organization_id, category, sort_by, sort_order } = query;
  const offset = (page - 1) * per_page;

  const searchParam       = search          ?? null;
  const statusParam       = status          ?? null;
  const priorityParam     = priority        ?? null;
  const assignedParam     = assigned_to     ?? null;
  const sourceParam       = source          ?? null;
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
      AND ($5::text IS NULL OR t.source         = $5)
      AND ($6::uuid IS NULL OR t.contact_id     = $6::uuid)
      AND ($7::uuid IS NULL OR t.organization_id = $7::uuid)
      AND ($8::text IS NULL OR t.category       = $8)`;

  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `${BASE_SELECT}${where}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $9 OFFSET $10`,
    searchParam, statusParam, priorityParam, assignedParam, sourceParam, contactParam, organizationParam, categoryParam,
    per_page, offset,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM tickets t${where}`,
    searchParam, statusParam, priorityParam, assignedParam, sourceParam, contactParam, organizationParam, categoryParam,
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
       (contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, title, description, status, priority, category,
        assigned_to, due_date, tags)
     VALUES
       ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'manual', $6, $7, $8, $9, $10, $11::uuid, $12::timestamptz, $13::text[])
     RETURNING
       id, contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, email_message_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS contact_name,  NULL AS organization_name,
       NULL AS type_name, NULL AS type_icon, NULL AS type_color`,
    data.contact_id      ?? null,
    data.organization_id ?? null,
    data.conversation_id ?? null,
    data.source_conversation_id ?? null,
    data.type_id ?? null,
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
  const hasTypeId = Object.prototype.hasOwnProperty.call(data, 'type_id');
  const typeIdValue = hasTypeId ? (data.type_id ?? null) : null;

  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `UPDATE tickets SET
       title           = COALESCE($1,        title),
       description     = COALESCE($2,        description),
       status          = COALESCE($3,        status),
       priority        = COALESCE($4,        priority),
       category        = COALESCE($5,        category),
       assigned_to     = COALESCE($6::uuid,  assigned_to),
       type_id         = CASE WHEN $7::boolean THEN $8::uuid ELSE type_id END,
       due_date        = COALESCE($9::timestamptz, due_date),
       tags            = COALESCE($10::text[], tags),
       resolved_at     = ${resolvedAt === 'NOW()' ? 'NOW()' : resolvedAt === 'NULL' ? 'NULL' : 'resolved_at'},
       updated_at      = NOW()
     WHERE id = $11::uuid
     RETURNING
       id, contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, email_message_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS contact_name,  NULL AS organization_name,
       NULL AS type_name, NULL AS type_icon, NULL AS type_color`,
    data.title          ?? null,
    data.description    ?? null,
    data.status         ?? null,
    data.priority       ?? null,
    data.category       ?? null,
    data.assigned_to    ?? null,
    hasTypeId,
    typeIdValue,
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
       id, contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, email_message_id, title, description, status, priority, category,
       assigned_to, resolved_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS contact_name,  NULL AS organization_name,
       NULL AS type_name, NULL AS type_icon, NULL AS type_color`,
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
       tc.id, tc.ticket_id, tc.user_id, tc.contact_id, tc.source, tc.content, tc.is_internal, tc.created_at,
       COALESCE(c.name, u.name) AS author_name,
       COALESCE(c.avatar_url, u.avatar_url) AS author_avatar
     FROM ticket_comments tc
     LEFT JOIN users u ON u.id = tc.user_id
     LEFT JOIN contacts c ON c.id = tc.contact_id
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
    `INSERT INTO ticket_comments (ticket_id, user_id, contact_id, source, content, is_internal)
     VALUES ($1::uuid, $2::uuid, NULL, 'agent', $3, $4)
     RETURNING
       id, ticket_id, user_id, contact_id, source, content, is_internal, created_at,
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
    `SELECT id, ticket_id, user_id, contact_id, source, content, is_internal, created_at,
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

/* ── attachments ─────────────────────────────────────────────────────────── */
export async function listAttachments(ticketId: string): Promise<TicketAttachmentRow[]> {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<TicketAttachmentRow[]>(
    `SELECT id, ticket_id, comment_id, user_id, filename, file_url, file_size, mime_type, created_at
     FROM ticket_attachments
     WHERE ticket_id = $1::uuid
     ORDER BY created_at DESC`,
    ticketId,
  );

  return rows;
}

export async function addAttachment(params: {
  ticketId: string;
  commentId?: string | null;
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<TicketAttachmentRow> {
  await ensureTicketInfrastructure();
  await getTicket(params.ticketId);

  if (!ALLOWED_ATTACHMENT_MIME.has(params.mimeType)) {
    throw new ForbiddenError('Tipo de arquivo não permitido');
  }

  if (params.buffer.length > MAX_ATTACHMENT_SIZE) {
    throw new ForbiddenError('Arquivo excede o limite de 15MB');
  }

  if (params.commentId) {
    const commentRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM ticket_comments
       WHERE id = $1::uuid
         AND ticket_id = $2::uuid
       LIMIT 1`,
      params.commentId,
      params.ticketId,
    );

    if (!commentRows[0]) {
      throw new NotFoundError('Comentário');
    }
  }

  const attachmentId = randomUUID();
  const safeName = sanitizeFileName(params.fileName);
  const storedFileName = `${attachmentId}-${safeName}`;
  const dir = await ensureAttachmentDir(params.ticketId);
  const filePath = path.join(dir, storedFileName);
  ensurePathInside(ATTACHMENTS_BASE_DIR, filePath);
  await fs.writeFile(filePath, params.buffer);

  const fileUrl = `/api/tickets/attachments/${attachmentId}/content`;

  const rows = await prisma.$queryRawUnsafe<TicketAttachmentRow[]>(
    `INSERT INTO ticket_attachments (id, ticket_id, comment_id, user_id, filename, file_url, file_size, mime_type)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8)
     RETURNING id, ticket_id, comment_id, user_id, filename, file_url, file_size, mime_type, created_at`,
    attachmentId,
    params.ticketId,
    params.commentId ?? null,
    params.userId,
    safeName,
    fileUrl,
    params.buffer.length,
    params.mimeType,
  );

  return rows[0]!;
}

export async function deleteAttachment(attachmentId: string, userId: string): Promise<{ deleted: true }> {
  await ensureTicketInfrastructure();

  const rows = await prisma.$queryRawUnsafe<TicketAttachmentRow[]>(
    `SELECT id, ticket_id, comment_id, user_id, filename, file_url, file_size, mime_type, created_at
     FROM ticket_attachments
     WHERE id = $1::uuid
     LIMIT 1`,
    attachmentId,
  );

  const attachment = rows[0];
  if (!attachment) throw new NotFoundError('Anexo');
  if (!attachment.user_id || attachment.user_id !== userId) {
    throw new ForbiddenError('Você não pode excluir este anexo');
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM ticket_attachments
     WHERE id = $1::uuid`,
    attachmentId,
  );

  const storedFileName = `${attachment.id}-${sanitizeFileName(attachment.filename)}`;
  const filePath = path.join(ATTACHMENTS_BASE_DIR, attachment.ticket_id, storedFileName);
  ensurePathInside(ATTACHMENTS_BASE_DIR, filePath);
  await fs.rm(filePath, { force: true }).catch(() => undefined);

  return { deleted: true };
}

export async function readAttachmentContent(attachmentId: string): Promise<{
  mimeType: string;
  filename: string;
  content: Buffer;
}> {
  await ensureTicketInfrastructure();

  const rows = await prisma.$queryRawUnsafe<TicketAttachmentRow[]>(
    `SELECT id, ticket_id, comment_id, user_id, filename, file_url, file_size, mime_type, created_at
     FROM ticket_attachments
     WHERE id = $1::uuid
     LIMIT 1`,
    attachmentId,
  );

  const attachment = rows[0];
  if (!attachment) throw new NotFoundError('Anexo');

  const storedFileName = `${attachment.id}-${sanitizeFileName(attachment.filename)}`;
  const filePath = path.join(ATTACHMENTS_BASE_DIR, attachment.ticket_id, storedFileName);
  ensurePathInside(ATTACHMENTS_BASE_DIR, filePath);
  const content = await fs.readFile(filePath);

  return {
    mimeType: attachment.mime_type ?? 'application/octet-stream',
    filename: attachment.filename,
    content,
  };
}

/* ── checklist ───────────────────────────────────────────────────────────── */
export async function listChecklistItems(ticketId: string): Promise<TicketChecklistRow[]> {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<TicketChecklistRow[]>(
    `SELECT
       tc.id,
       tc.ticket_id,
       tc.title,
       tc.is_done,
       tc.done_by,
       tc.done_at,
       tc.sort_order,
       tc.created_at,
       u.name AS done_by_name
     FROM ticket_checklists tc
     LEFT JOIN users u ON u.id = tc.done_by
     WHERE tc.ticket_id = $1::uuid
     ORDER BY tc.sort_order, tc.created_at ASC`,
    ticketId,
  );

  return rows;
}

export async function addChecklistItem(ticketId: string, title: string): Promise<TicketChecklistRow> {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<TicketChecklistRow[]>(
    `WITH inserted AS (
       INSERT INTO ticket_checklists (ticket_id, title, sort_order)
       VALUES (
         $1::uuid,
         $2,
         (
           SELECT COALESCE(MAX(sort_order), 0) + 1
           FROM ticket_checklists
           WHERE ticket_id = $1::uuid
         )
       )
       RETURNING id, ticket_id, title, is_done, done_by, done_at, sort_order, created_at
     )
     SELECT
       i.id,
       i.ticket_id,
       i.title,
       i.is_done,
       i.done_by,
       i.done_at,
       i.sort_order,
       i.created_at,
       NULL::text AS done_by_name
     FROM inserted i`,
    ticketId,
    title,
  );

  return rows[0]!;
}

export async function updateChecklistItem(
  ticketId: string,
  itemId: string,
  payload: UpdateChecklistItemInput,
  userId: string,
): Promise<TicketChecklistRow> {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<TicketChecklistRow[]>(
    `WITH updated AS (
       UPDATE ticket_checklists
       SET
         is_done = COALESCE($1::boolean, is_done),
         done_by = CASE
           WHEN $1::boolean = true THEN $2::uuid
           WHEN $1::boolean = false THEN NULL
           ELSE done_by
         END,
         done_at = CASE
           WHEN $1::boolean = true THEN NOW()
           WHEN $1::boolean = false THEN NULL
           ELSE done_at
         END,
         title = COALESCE($3, title)
       WHERE id = $4::uuid
         AND ticket_id = $5::uuid
       RETURNING id, ticket_id, title, is_done, done_by, done_at, sort_order, created_at
     )
     SELECT
       u2.id,
       u2.ticket_id,
       u2.title,
       u2.is_done,
       u2.done_by,
       u2.done_at,
       u2.sort_order,
       u2.created_at,
       u.name AS done_by_name
     FROM updated u2
     LEFT JOIN users u ON u.id = u2.done_by`,
    payload.is_done ?? null,
    userId,
    payload.title ?? null,
    itemId,
    ticketId,
  );

  if (!rows[0]) throw new NotFoundError('Item do checklist');
  return rows[0];
}

export async function deleteChecklistItem(ticketId: string, itemId: string): Promise<{ deleted: true }> {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `DELETE FROM ticket_checklists
     WHERE id = $1::uuid
       AND ticket_id = $2::uuid
     RETURNING id`,
    itemId,
    ticketId,
  );

  if (!rows[0]) throw new NotFoundError('Item do checklist');
  return { deleted: true };
}

/* ── time tracking ───────────────────────────────────────────────────────── */
export async function listTimeEntries(ticketId: string): Promise<TicketTimeEntryRow[]> {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<TicketTimeEntryRow[]>(
    `SELECT
       te.id,
       te.ticket_id,
       te.user_id,
       te.description,
       te.minutes,
       te.worked_at,
       te.created_at,
       u.name AS user_name
     FROM ticket_time_entries te
     JOIN users u ON u.id = te.user_id
     WHERE te.ticket_id = $1::uuid
     ORDER BY te.worked_at DESC, te.created_at DESC`,
    ticketId,
  );

  return rows;
}

export async function addTimeEntry(
  ticketId: string,
  userId: string,
  payload: CreateTimeEntryInput,
): Promise<TicketTimeEntryRow> {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<TicketTimeEntryRow[]>(
    `WITH inserted AS (
       INSERT INTO ticket_time_entries
         (ticket_id, user_id, minutes, description, worked_at)
       VALUES
         ($1::uuid, $2::uuid, $3::integer, $4, COALESCE($5::date, CURRENT_DATE))
       RETURNING id, ticket_id, user_id, description, minutes, worked_at, created_at
     )
     SELECT
       i.id,
       i.ticket_id,
       i.user_id,
       i.description,
       i.minutes,
       i.worked_at,
       i.created_at,
       u.name AS user_name
     FROM inserted i
     JOIN users u ON u.id = i.user_id`,
    ticketId,
    userId,
    payload.minutes,
    payload.description ?? null,
    payload.worked_at ?? null,
  );

  return rows[0]!;
}

export async function deleteTimeEntry(
  ticketId: string,
  entryId: string,
  currentUserId: string,
  role: string,
): Promise<{ deleted: true }> {
  await ensureTicketInfrastructure();
  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; user_id: string }>>(
    `SELECT id, user_id
     FROM ticket_time_entries
     WHERE id = $1::uuid
       AND ticket_id = $2::uuid
     LIMIT 1`,
    entryId,
    ticketId,
  );

  const entry = rows[0];
  if (!entry) throw new NotFoundError('Registro de tempo');

  const canDelete = entry.user_id === currentUserId || role === 'owner' || role === 'admin';
  if (!canDelete) {
    throw new ForbiddenError('Você não pode excluir este apontamento');
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM ticket_time_entries
     WHERE id = $1::uuid`,
    entryId,
  );

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
