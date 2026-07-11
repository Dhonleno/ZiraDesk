import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { getSocketServer } from '../../socket/index.js';
import { dispatchWebhook } from '../../services/webhook-dispatcher.js';
import { ensureAgentAssignmentsInfrastructure } from '../omnichannel/conversations/auto-assign.service.js';
import { PRESENCE_TIMEOUT_MS } from '../omnichannel/presence.constants.js';
import { syncCommentToRedmine, syncTicketToRedmine } from '../integrations/redmine/redmine.service.js';
import { buildTenantUrl } from '../../utils/url.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getStorage, StorageObjectNotFoundError } from '../../lib/storage/index.js';
import {
  sendTicketCsatEmail,
  sendTicketCommentEmail,
  sendTicketOpenedEmail,
  sendTicketResolvedEmail,
} from './ticket-emails.service.js';
import type {
  CreateTicketInput,
  UpdateTicketInput,
  ListTicketsQuery,
  ExportTicketsQuery,
  CreateCommentInput,
  UpdateCommentInput,
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

export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessRuleError';
  }
}

export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/* ── Row interfaces ──────────────────────────────────────────────────────── */
interface TicketRow {
  id:               string;
  ticket_number:    number;
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
  waiting_reason:   string | null;
  sla_paused_at:    Date | null;
  sla_paused_duration_seconds: number;
  escalated:        boolean;
  escalated_at:     Date | null;
  csat_score:       number | null;
  csat_comment:     string | null;
  csat_sent_at:     Date | null;
  csat_responded_at: Date | null;
  csat_expires_at:  Date | null;
  priority:         string;
  category:         string | null;
  assigned_to:      string | null;
  department_id:    string | null;
  resolved_at:      Date | null;
  resolution_notes: string | null;
  closed_at:        Date | null;
  due_date:         Date | null;
  tags:             string[];
  custom_fields:    unknown;
  created_at:       Date;
  updated_at:       Date;
  assignee_name:    string | null;
  assignee_avatar:  string | null;
  contact_name:     string | null;
  contact_email:    string | null;
  contact_phone:    string | null;
  contact_document: string | null;
  organization_name: string | null;
  type_name:        string | null;
  type_icon:        string | null;
  type_color:       string | null;
  department_name:  string | null;
}

interface TicketExportRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  category: string | null;
  created_at: Date;
  updated_at: Date;
  due_date: Date | null;
  resolved_at: Date | null;
  assigned_to_name: string | null;
  contact_name: string | null;
  organization_name: string | null;
  ticket_type_name: string | null;
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
  attachments: TicketCommentAttachmentRow[];
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

interface TicketCommentAttachmentRow {
  id: string;
  filename: string;
  file_url: string;
  mime_type: string | null;
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

interface TicketTypeRuleRow {
  require_due_date_for_urgent: boolean;
  require_category_for_waiting: boolean;
}

const STATUS_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  queued:      new Set(['open']), // apenas via claimTicketFromQueue
  open:        new Set(['in_progress', 'waiting']),
  in_progress: new Set(['open', 'waiting', 'resolved']),
  waiting:     new Set(['open', 'in_progress']),
  resolved:    new Set(['open', 'in_progress', 'closed']),
  closed:      new Set(['open']),
};

function ensureValidStatusTransition(fromStatus: string, toStatus: string): void {
  if (fromStatus === toStatus) return;
  const allowed = STATUS_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.has(toStatus)) {
    throw new BusinessRuleError(`Transição de status inválida: ${fromStatus} -> ${toStatus}`);
  }
}

function ensureTicketConditionalRules(input: {
  status: string;
  priority: string;
  category: string | null;
  dueDate: string | Date | null;
  requireDueDateForUrgent: boolean;
  requireCategoryForWaiting: boolean;
}): void {
  if (input.requireDueDateForUrgent && input.priority === 'urgent' && !input.dueDate) {
    throw new BusinessRuleError('Prazo é obrigatório para tickets urgentes');
  }

  if (input.requireCategoryForWaiting && input.status === 'waiting' && !(input.category ?? '').trim()) {
    throw new BusinessRuleError('Categoria é obrigatória quando o status é "Aguardando"');
  }
}

async function getTicketTypeRules(typeId: string | null, db: RawExecutor = prisma): Promise<TicketTypeRuleRow> {
  if (!typeId) {
    return {
      require_due_date_for_urgent: true,
      require_category_for_waiting: true,
    };
  }

  const rows = await db.$queryRawUnsafe<TicketTypeRuleRow[]>(
    `SELECT require_due_date_for_urgent, require_category_for_waiting
     FROM ticket_types
     WHERE id = $1::uuid
     LIMIT 1`,
    typeId,
  );

  if (!rows[0]) {
    return {
      require_due_date_for_urgent: true,
      require_category_for_waiting: true,
    };
  }

  return rows[0];
}

interface DepartmentAgentCandidateRow {
  id: string;
  name: string;
}

// Round-robin por departamento, com presença obrigatória (Bloco B): considera
// apenas agente ativo (role='agent', status='active') vinculado ao
// departamento, online, disponível e com heartbeat recente, ordenado pelo
// mais antigo em last_assigned_at (agent_assignments), espelhando o critério
// de resolveAgentForAssignment em omnichannel/conversations/auto-assign.service.ts.
async function pickNextAgentForDepartment(
  db: RawExecutor,
  departmentId: string,
): Promise<DepartmentAgentCandidateRow | null> {
  const rows = await db.$queryRawUnsafe<DepartmentAgentCandidateRow[]>(
    `SELECT u.id, u.name
     FROM agent_departments ad
     JOIN agent_assignments aa ON aa.user_id = ad.user_id
     JOIN users u ON u.id = ad.user_id
     WHERE ad.department_id = $1::uuid
       AND u.status = 'active'
       AND u.role = 'agent'
       -- Bloco B: presença obrigatória (espelha resolveAgentForAssignment)
       AND aa.status = 'online'
       AND aa.is_available = true
       AND aa.last_seen_at > NOW() - (${PRESENCE_TIMEOUT_MS / 60_000} * INTERVAL '1 minute')
     ORDER BY aa.last_assigned_at ASC
     LIMIT 1`,
    departmentId,
  );

  const agent = rows[0];
  if (!agent) return null;

  await db.$executeRawUnsafe(
    `UPDATE agent_assignments SET last_assigned_at = NOW() WHERE user_id = $1::uuid`,
    agent.id,
  );

  return agent;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function toPgArray(arr: string[]): string {
  if (!arr.length) return '{}';
  return '{' + arr.map(t => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',') + '}';
}

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
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).trim();
  const normalized = base.replace(/[^\w.\-()\s]/g, '_').replace(/\s+/g, '_');
  return normalized || 'arquivo';
}

function buildAttachmentStorageKey(ticketId: string, attachmentId: string, fileName: string): string {
  return `tickets/${ticketId}/${attachmentId}-${sanitizeFileName(fileName)}`;
}

type RawExecutor = typeof prisma;
let ticketInfraEnsured = false;

function ensureSafeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/i.test(schemaName)) {
    throw new ForbiddenError('Schema do tenant inválido');
  }
  return schemaName.replace(/"/g, '""');
}

async function withTenantSchema<T>(
  schemaName: string,
  runner: (db: RawExecutor) => Promise<T>,
): Promise<T> {
  const safeSchemaName = ensureSafeSchemaName(schemaName);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);
    return runner(tx as RawExecutor);
  });
}

async function withOptionalSchema<T>(
  schemaName: string | undefined,
  runner: (db: RawExecutor) => Promise<T>,
): Promise<T> {
  if (schemaName) {
    return withTenantSchema(schemaName, runner);
  }

  return runner(prisma);
}

async function ensureTicketInfrastructure(db: RawExecutor = prisma): Promise<void> {
  if (ticketInfraEnsured) return;

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ticket_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(80) NOT NULL,
      icon VARCHAR(20) NOT NULL DEFAULT '🎫',
      color VARCHAR(7) NOT NULL DEFAULT '#00C9A7',
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      require_due_date_for_urgent BOOLEAN NOT NULL DEFAULT true,
      require_category_for_waiting BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE ticket_types
    ADD COLUMN IF NOT EXISTS require_due_date_for_urgent BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS require_category_for_waiting BOOLEAN NOT NULL DEFAULT true
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_types_name_unique
    ON ticket_types (LOWER(name))
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS email_message_id VARCHAR(500)
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_email_message_id
    ON tickets(email_message_id)
    WHERE email_message_id IS NOT NULL
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS type_id UUID REFERENCES ticket_types(id) ON DELETE SET NULL
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tickets_department_id
    ON tickets(department_id)
    WHERE department_id IS NOT NULL
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS waiting_reason VARCHAR(30),
    ADD COLUMN IF NOT EXISTS sla_paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sla_paused_duration_seconds INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS escalated BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS csat_score SMALLINT,
    ADD COLUMN IF NOT EXISTS csat_comment TEXT,
    ADD COLUMN IF NOT EXISTS csat_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS csat_responded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS csat_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ticket_number SERIAL
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tickets_type_id
    ON tickets(type_id)
  `);

  await db.$executeRawUnsafe(`
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

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket
    ON ticket_events(ticket_id)
  `);

  await db.$executeRawUnsafe(`
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

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket
    ON ticket_attachments(ticket_id)
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE ticket_attachments
    ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES ticket_comments(id) ON DELETE CASCADE
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE ticket_comments
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'agent'
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE ticket_comments
    ALTER COLUMN user_id DROP NOT NULL
  `);

  await db.$executeRawUnsafe(`
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

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ticket_checklists_ticket
    ON ticket_checklists(ticket_id)
  `);

  await db.$executeRawUnsafe(`
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

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_time_entries_ticket
    ON ticket_time_entries(ticket_id)
  `);

  ticketInfraEnsured = true;
}

export async function ensureTicketInfrastructureForSchema(schemaName: string): Promise<void> {
  await withTenantSchema(schemaName, async (db) => {
    await ensureTicketInfrastructure(db);
  });
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
  await ensureTicketInfrastructure(tx);

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

const tenantSchemaCache = new Map<string, string>();

async function resolveTenantSchemaName(tenantId: string): Promise<string | null> {
  const cached = tenantSchemaCache.get(tenantId);
  if (cached) return cached;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  if (!tenant) return null;
  tenantSchemaCache.set(tenantId, tenant.schemaName);
  return tenant.schemaName;
}

async function resolveTenantInfo(tenantId: string): Promise<{
  schemaName: string;
  tenantName: string;
  tenantSlug: string;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true, name: true, slug: true },
  });
  if (!tenant) throw new NotFoundError('Tenant');

  tenantSchemaCache.set(tenantId, tenant.schemaName);
  return {
    schemaName: tenant.schemaName,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
  };
}

const BASE_SELECT = `
  SELECT
    t.id, t.ticket_number, t.contact_id, t.organization_id, t.conversation_id, t.source_conversation_id, t.type_id, t.source, t.email_message_id, t.title, t.description,
    t.status, t.waiting_reason, t.sla_paused_at, t.sla_paused_duration_seconds, t.escalated, t.escalated_at,
    t.csat_score, t.csat_comment, t.csat_sent_at, t.csat_responded_at, t.csat_expires_at,
    t.priority, t.category, t.assigned_to, t.department_id, t.resolved_at, t.resolution_notes, t.closed_at,
    t.due_date, t.tags, t.custom_fields, t.created_at, t.updated_at,
    u.name        AS assignee_name,
    u.avatar_url  AS assignee_avatar,
    ct.name       AS contact_name,
    ct.email      AS contact_email,
    ct.phone      AS contact_phone,
    ct.document   AS contact_document,
    o.name        AS organization_name,
    tt.name       AS type_name,
    tt.icon       AS type_icon,
    tt.color      AS type_color,
    dp.name       AS department_name
  FROM tickets t
  LEFT JOIN users         u  ON u.id  = t.assigned_to
  LEFT JOIN contacts      ct ON ct.id = t.contact_id
  LEFT JOIN organizations o  ON o.id  = t.organization_id
  LEFT JOIN ticket_types  tt ON tt.id = t.type_id
  LEFT JOIN departments   dp ON dp.id = t.department_id`;

const TICKET_SEARCH_CONDITION = `(
  $1::text IS NULL
  OR t.title ILIKE '%' || $1 || '%'
  OR t.description ILIKE '%' || $1 || '%'
  OR (
    NULLIF(regexp_replace($1, '[^0-9]', '', 'g'), '') IS NOT NULL
    AND (
      lpad(t.ticket_number::text, 5, '0') ILIKE '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%'
      OR (
        NULLIF(ltrim(regexp_replace($1, '[^0-9]', '', 'g'), '0'), '') IS NOT NULL
        AND t.ticket_number::text ILIKE '%' || ltrim(regexp_replace($1, '[^0-9]', '', 'g'), '0') || '%'
      )
    )
  )
  OR ct.name ILIKE '%' || $1 || '%'
  OR ct.email ILIKE '%' || $1 || '%'
  OR o.name ILIKE '%' || $1 || '%'
)`;

/* ── listTickets ─────────────────────────────────────────────────────────── */
export async function listTickets(query: ListTicketsQuery, schemaName?: string) {
  return withOptionalSchema(schemaName, async (db) => {
    await ensureTicketInfrastructure(db);
    const { page, per_page, search, status, priority, assigned_to, department_id, source, contact_id, organization_id, category, sort_by, sort_order } = query;
    const offset = (page - 1) * per_page;

    const searchParam       = search          ?? null;
    const statusParam       = status          ?? null;
    const priorityParam     = priority        ?? null;
    const assignedParam     = assigned_to     ?? null;
    const sourceParam       = source          ?? null;
    const contactParam      = contact_id      ?? null;
    const organizationParam = organization_id ?? null;
    const categoryParam     = category        ?? null;
    const departmentParam   = department_id   ?? null;

    const sortCol = SORT_COLUMNS[sort_by] ?? 't.created_at';
    const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

    const where = `
      WHERE ${TICKET_SEARCH_CONDITION}
        AND ($2::text IS NULL OR t.status         = $2)
        AND ($3::text IS NULL OR t.priority       = $3)
        AND ($4::uuid IS NULL OR t.assigned_to    = $4::uuid)
        AND ($5::text IS NULL OR t.source         = $5)
        AND ($6::uuid IS NULL OR t.contact_id     = $6::uuid)
        AND ($7::uuid IS NULL OR t.organization_id = $7::uuid)
        AND ($8::text IS NULL OR t.category       = $8)
        AND ($9::uuid IS NULL OR t.department_id  = $9::uuid)`;

    const rows = await db.$queryRawUnsafe<TicketRow[]>(
      `${BASE_SELECT}${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $10 OFFSET $11`,
      searchParam, statusParam, priorityParam, assignedParam, sourceParam, contactParam, organizationParam, categoryParam, departmentParam,
      per_page, offset,
    );

    const countRows = await db.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count
       FROM tickets t
       LEFT JOIN contacts      ct ON ct.id = t.contact_id
       LEFT JOIN organizations o  ON o.id  = t.organization_id
       ${where}`,
      searchParam, statusParam, priorityParam, assignedParam, sourceParam, contactParam, organizationParam, categoryParam, departmentParam,
    );

    const total = Number(countRows[0]?.count ?? 0);
    return {
      data: rows,
      meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
    };
  });
}

/* ── exportTickets ───────────────────────────────────────────────────────── */
export async function exportTickets(query: ExportTicketsQuery, schemaName?: string): Promise<TicketExportRow[]> {
  return withOptionalSchema(schemaName, async (db) => {
    await ensureTicketInfrastructure(db);

    const searchParam       = query.search          ?? null;
    const statusParam       = query.status          ?? null;
    const priorityParam     = query.priority        ?? null;
    const assignedParam     = query.assigned_to     ?? null;
    const sourceParam       = query.source          ?? null;
    const contactParam      = query.contact_id      ?? null;
    const organizationParam = query.organization_id ?? null;
    const categoryParam     = query.category        ?? null;
    const departmentParam   = query.department_id   ?? null;

    const dateFrom = query.date_from ? new Date(query.date_from) : null;
    const dateTo = query.date_to ? new Date(query.date_to) : null;
    const dateFromParam = dateFrom && !Number.isNaN(dateFrom.getTime()) ? dateFrom : null;
    const dateToParam = dateTo && !Number.isNaN(dateTo.getTime()) ? dateTo : null;

    return db.$queryRawUnsafe<TicketExportRow[]>(
      `SELECT
         t.id,
         t.title,
         t.status,
         t.priority,
         t.category,
         t.created_at,
         t.updated_at,
         t.due_date,
         t.resolved_at,
         u.name AS assigned_to_name,
         ct.name AS contact_name,
         o.name AS organization_name,
         tt.name AS ticket_type_name
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN contacts ct ON ct.id = t.contact_id
       LEFT JOIN organizations o ON o.id = t.organization_id
       LEFT JOIN ticket_types tt ON tt.id = t.type_id
       WHERE ${TICKET_SEARCH_CONDITION}
         AND ($2::text IS NULL OR t.status = $2)
         AND ($3::text IS NULL OR t.priority = $3)
         AND ($4::uuid IS NULL OR t.assigned_to = $4::uuid)
         AND ($5::text IS NULL OR t.source = $5)
         AND ($6::uuid IS NULL OR t.contact_id = $6::uuid)
         AND ($7::uuid IS NULL OR t.organization_id = $7::uuid)
         AND ($8::text IS NULL OR t.category = $8)
         AND ($9::timestamptz IS NULL OR t.created_at >= $9::timestamptz)
         AND ($10::timestamptz IS NULL OR t.created_at <= $10::timestamptz)
         AND ($11::uuid IS NULL OR t.department_id = $11::uuid)
       ORDER BY t.created_at DESC
       LIMIT 10000`,
      searchParam,
      statusParam,
      priorityParam,
      assignedParam,
      sourceParam,
      contactParam,
      organizationParam,
      categoryParam,
      dateFromParam,
      dateToParam,
      departmentParam,
    );
  });
}

/* ── getTicket ───────────────────────────────────────────────────────────── */
export async function getTicket(id: string, schemaName?: string, db?: RawExecutor): Promise<TicketRow> {
  if (db) {
    await ensureTicketInfrastructure(db);
    const rows = await db.$queryRawUnsafe<TicketRow[]>(
      `${BASE_SELECT}
       WHERE t.id = $1::uuid
       LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundError('Ticket');
    return rows[0];
  }

  if (schemaName) {
    return withTenantSchema(schemaName, async (tx) => getTicket(id, undefined, tx));
  }

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
export async function createTicket(data: CreateTicketInput, createdBy: string, tenantId: string, schemaName?: string) {
  const tenantRecord = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const tenantSettings = (tenantRecord?.settings as Record<string, unknown> | null) ?? {};
  const ticketAutoAssign = tenantSettings['ticket_auto_assign'] === true;

  const { ticket, createdEvent } = await withOptionalSchema(schemaName, async (db) => {
    await ensureTicketInfrastructure(db);
    const typeRules = await getTicketTypeRules(data.type_id ?? null, db);
    ensureTicketConditionalRules({
      status: data.status,
      priority: data.priority,
      category: data.category ?? null,
      dueDate: data.due_date ?? null,
      requireDueDateForUrgent: typeRules.require_due_date_for_urgent,
      requireCategoryForWaiting: typeRules.require_category_for_waiting,
    });

    let finalAssignedTo = data.assigned_to ?? null;
    let finalStatus: string = data.status;
    const finalDepartmentId = data.department_id ?? null;

    // Ticket precisa vir com agente explícito, departamento, ou ambos.
    if (!finalDepartmentId && !finalAssignedTo) {
      throw new BusinessRuleError('Ticket precisa ter um agente responsável ou um departamento');
    }

    // Se assigned_to já veio explícito, usa direto — ignora auto-assign e
    // round-robin por departamento, mesmo que department_id também tenha sido informado.
    // Auto-assign por departamento (round-robin): só atua quando o ticket
    // chega só com departamento (sem agente explícito) e o tenant tem
    // ticket_auto_assign ligado.
    if (ticketAutoAssign && finalDepartmentId && !finalAssignedTo && schemaName) {
      await ensureAgentAssignmentsInfrastructure(prisma, schemaName);
      const nextAgent = await pickNextAgentForDepartment(db, finalDepartmentId);
      if (nextAgent) {
        finalAssignedTo = nextAgent.id;
      } else {
        // Sem agente online no departamento — ticket permanece queued até claim manual
        finalStatus = 'queued';
      }
    }

    // Departamento sem agente resolvido (auto-assign desligado ou sem candidato
    // disponível) entra na fila para ser reivindicado via claimTicketFromQueue.
    if (!finalAssignedTo && finalDepartmentId) {
      finalStatus = 'queued';
    }

    if (finalAssignedTo) {
      const userExists = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM users WHERE id = $1::uuid AND status = 'active' LIMIT 1`,
        finalAssignedTo,
      );
      if (!userExists.length) {
        throw new BusinessRuleError('Usuário responsável não encontrado ou inativo');
      }
    }

    const tagsLiteral = toPgArray(data.tags ?? []);

    const rows = await db.$queryRawUnsafe<TicketRow[]>(
      `INSERT INTO tickets
         (contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, title, description, status, priority, category,
          assigned_to, department_id, due_date, tags)
       VALUES
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'manual', $6, $7, $8, $9, $10, $11::uuid, $12::uuid, $13::timestamptz, $14::text[])
       RETURNING
         id, ticket_number, contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, email_message_id, title, description,
         status, waiting_reason, sla_paused_at, sla_paused_duration_seconds, escalated, escalated_at,
         csat_score, csat_comment, csat_sent_at, csat_responded_at, csat_expires_at, priority, category,
         assigned_to, department_id, resolved_at, resolution_notes, closed_at, due_date, tags, custom_fields, created_at, updated_at,
         NULL AS assignee_name, NULL AS assignee_avatar,
         NULL AS contact_name, NULL AS contact_email, NULL AS contact_phone, NULL AS contact_document, NULL AS organization_name,
         NULL AS type_name, NULL AS type_icon, NULL AS type_color, NULL AS department_name`,
      data.contact_id      ?? null,
      data.organization_id ?? null,
      data.conversation_id ?? null,
      data.source_conversation_id ?? null,
      data.type_id ?? null,
      data.title,
      data.description     ?? null,
      finalStatus,
      data.priority,
      data.category        ?? null,
      finalAssignedTo,
      finalDepartmentId,
      data.due_date        ?? null,
      tagsLiteral,
    );

    const ticket = rows[0]!;

    await db.$executeRawUnsafe(
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
      db,
    );

    return { ticket, createdEvent };
  });

  if (createdEvent) emitTicketEvent(tenantId, ticket.id, createdEvent);

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:created', { ticket });
  } catch { /* socket não inicializado em testes */ }

  void dispatchWebhook(tenantId, 'ticket.created', {
    ticket: { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority, assignedTo: ticket.assigned_to },
  });
  void (async () => {
    const tenantInfo = await resolveTenantInfo(tenantId);
    const fullTicket = await getTicket(ticket.id, tenantInfo.schemaName);
    if (!fullTicket.contact_email) return;

    const ticketUrl = buildTenantUrl(tenantInfo.tenantSlug, `/portal/tickets/${ticket.id}`);
    void sendTicketOpenedEmail({
      tenantId,
      tenantSchema: tenantInfo.schemaName,
      tenantName: tenantInfo.tenantName,
      contactEmail: fullTicket.contact_email,
      contactName: fullTicket.contact_name ?? '',
      ticketNumber: fullTicket.ticket_number,
      ticketTitle: fullTicket.title,
      ticketPriority: fullTicket.priority,
      ticketUrl,
    });
  })().catch(() => {});
  void (async () => {
    const resolvedSchemaName = schemaName ?? await resolveTenantSchemaName(tenantId);
    if (!resolvedSchemaName) return;
    await syncTicketToRedmine(tenantId, resolvedSchemaName, ticket.id, 'created');
  })().catch(() => {});

  return ticket;
}

/* ── updateTicket ────────────────────────────────────────────────────────── */
export async function updateTicket(id: string, data: UpdateTicketInput, updatedBy: string, tenantId: string, schemaName?: string) {
  const { old, ticket, eventsToEmit } = await withOptionalSchema(schemaName, async (db) => {
    await ensureTicketInfrastructure(db);
    const old = await getTicket(id, undefined, db);

    const newStatus = data.status ?? old.status;
    ensureValidStatusTransition(old.status, newStatus);
    const newPriority = data.priority ?? old.priority;
    const hasCategoryField = Object.prototype.hasOwnProperty.call(data, 'category');
    const newCategory = hasCategoryField ? (data.category ?? null) : old.category;
    const newDueDate = data.due_date ?? old.due_date;
    const hasTypeId = Object.prototype.hasOwnProperty.call(data, 'type_id');
    const newTypeId = hasTypeId ? (data.type_id ?? null) : old.type_id;
    const typeRules = await getTicketTypeRules(newTypeId, db);
    ensureTicketConditionalRules({
      status: newStatus,
      priority: newPriority,
      category: newCategory,
      dueDate: newDueDate,
      requireDueDateForUrgent: typeRules.require_due_date_for_urgent,
      requireCategoryForWaiting: typeRules.require_category_for_waiting,
    });
    const resolvedAt =
      newStatus === 'resolved' && old.status !== 'resolved' ? 'NOW()' :
      old.status === 'resolved' && newStatus !== 'resolved' && newStatus !== 'closed' ? 'NULL' : 'resolved_at';
    const closedAt =
      newStatus === 'closed' && old.status !== 'closed' ? 'NOW()' :
      old.status === 'closed' && newStatus !== 'closed' ? 'NULL' : 'closed_at';

    const tagsLiteral = data.tags !== undefined ? toPgArray(data.tags) : null;
    const typeIdValue = hasTypeId ? (data.type_id ?? null) : null;
    const hasAssignedTo = Object.prototype.hasOwnProperty.call(data, 'assigned_to');
    const assignedToValue = hasAssignedTo ? (data.assigned_to ?? null) : null;
    const hasDepartmentId = Object.prototype.hasOwnProperty.call(data, 'department_id');
    const departmentIdValue = hasDepartmentId ? (data.department_id ?? null) : null;
    let waitingReason: string | null | undefined;
    if (data.status === 'waiting') {
      waitingReason = data.waiting_reason ?? null;
    } else if (data.status !== undefined) {
      waitingReason = null;
    }
    const hasWaitingReason = waitingReason !== undefined;
    let slaPausedAt: 'NOW()' | null | undefined;
    let accumulateSlaPausedDuration = false;

    if (old.status !== 'waiting' && newStatus === 'waiting' && data.waiting_reason === 'customer') {
      slaPausedAt = 'NOW()';
    }

    if (
      old.status === 'waiting' &&
      old.waiting_reason === 'customer' &&
      newStatus !== 'waiting' &&
      old.sla_paused_at !== null
    ) {
      slaPausedAt = null;
      accumulateSlaPausedDuration = true;
    }

    const slaPausedAtSql =
      slaPausedAt === 'NOW()' ? 'NOW()' :
      slaPausedAt === null ? 'NULL' :
      'sla_paused_at';
    const slaPausedDurationSql = accumulateSlaPausedDuration
      ? `sla_paused_duration_seconds + GREATEST(0, EXTRACT(EPOCH FROM NOW() - sla_paused_at)::integer)`
      : 'sla_paused_duration_seconds';

    const rows = await db.$queryRawUnsafe<TicketRow[]>(
      `UPDATE tickets SET
         title           = COALESCE($1,        title),
         description     = COALESCE($2,        description),
         status          = COALESCE($3,        status),
         priority        = COALESCE($4,        priority),
         category        = COALESCE($5,        category),
         assigned_to     = CASE WHEN $6::boolean THEN $7::uuid ELSE assigned_to END,
         type_id         = CASE WHEN $8::boolean THEN $9::uuid ELSE type_id END,
         due_date        = COALESCE($10::timestamptz, due_date),
         tags            = COALESCE($11::text[], tags),
         resolution_notes = COALESCE($12::text, resolution_notes),
         waiting_reason  = CASE WHEN $13::boolean THEN $14::text ELSE waiting_reason END,
         department_id   = CASE WHEN $16::boolean THEN $17::uuid ELSE department_id END,
         sla_paused_at    = ${slaPausedAtSql},
         sla_paused_duration_seconds = ${slaPausedDurationSql},
         resolved_at     = ${resolvedAt === 'NOW()' ? 'NOW()' : resolvedAt === 'NULL' ? 'NULL' : 'resolved_at'},
         closed_at       = ${closedAt === 'NOW()' ? 'NOW()' : closedAt === 'NULL' ? 'NULL' : 'closed_at'},
         updated_at      = NOW()
       WHERE id = $15::uuid
       RETURNING
         id, ticket_number, contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, email_message_id, title, description,
         status, waiting_reason, sla_paused_at, sla_paused_duration_seconds, escalated, escalated_at,
         csat_score, csat_comment, csat_sent_at, csat_responded_at, csat_expires_at, priority, category,
         assigned_to, department_id, resolved_at, resolution_notes, closed_at, due_date, tags, custom_fields, created_at, updated_at,
         NULL AS assignee_name, NULL AS assignee_avatar,
         NULL AS contact_name, NULL AS contact_email, NULL AS contact_phone, NULL AS contact_document, NULL AS organization_name,
         NULL AS type_name, NULL AS type_icon, NULL AS type_color, NULL AS department_name`,
      data.title ?? null,
      data.description ?? null,
      data.status ?? null,
      data.priority ?? null,
      data.category ?? null,
      hasAssignedTo,
      assignedToValue,
      hasTypeId,
      typeIdValue,
      data.due_date ?? null,
      tagsLiteral,
      data.resolution_notes ?? null,
      hasWaitingReason,
      waitingReason ?? null,
      id,
      hasDepartmentId,
      departmentIdValue,
    );

    if (!rows[0]) throw new NotFoundError('Ticket');
    const ticket = rows[0];

    await db.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
       VALUES ($1::uuid, 'ticket.updated', 'ticket', $2::uuid, $3::jsonb, $4::jsonb)`,
      updatedBy,
      id,
      JSON.stringify(old),
      JSON.stringify(ticket),
    );

    const eventsToEmit: Array<{ event: TicketEventRow; userName?: string | null }> = [];

    if (old.status !== ticket.status) {
      const statusEvent = await logTicketEvent(id, updatedBy, 'status_changed', old.status, ticket.status, undefined, db);
      if (statusEvent) eventsToEmit.push({ event: statusEvent });
    }

    if (old.status !== 'waiting' && ticket.status === 'waiting') {
      const waitingEvent = await logTicketEvent(
        id,
        updatedBy,
        'waiting',
        old.status,
        'waiting',
        { reason: ticket.waiting_reason },
        db,
      );
      if (waitingEvent) eventsToEmit.push({ event: waitingEvent });
    }

    if (old.priority !== ticket.priority) {
      const priorityEvent = await logTicketEvent(id, updatedBy, 'priority_changed', old.priority, ticket.priority, undefined, db);
      if (priorityEvent) eventsToEmit.push({ event: priorityEvent });
    }

    let assigneeName: string | null = null;
    if (old.assigned_to !== ticket.assigned_to) {
      if (ticket.assigned_to) {
        const assigneeRows = await db.$queryRawUnsafe<Array<{ name: string | null }>>(
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
        db,
      );

      if (assignedEvent) eventsToEmit.push({ event: assignedEvent, userName: assigneeName });
    }

    const oldTags = new Set(old.tags ?? []);
    const newTags = new Set(ticket.tags ?? []);
    const addedTags = [...newTags].filter((tag) => !oldTags.has(tag));
    const removedTags = [...oldTags].filter((tag) => !newTags.has(tag));

    for (const tag of addedTags) {
      const tagAddedEvent = await logTicketEvent(id, updatedBy, 'tag_added', null, tag, undefined, db);
      if (tagAddedEvent) eventsToEmit.push({ event: tagAddedEvent });
    }

    for (const tag of removedTags) {
      const tagRemovedEvent = await logTicketEvent(id, updatedBy, 'tag_removed', tag, null, undefined, db);
      if (tagRemovedEvent) eventsToEmit.push({ event: tagRemovedEvent });
    }

    return { old, ticket, eventsToEmit };
  });

  for (const { event, userName } of eventsToEmit) {
    emitTicketEvent(tenantId, id, event, userName);
  }

  if (old.status !== 'resolved' && ticket.status === 'resolved') {
    const resolvedEvent = await withOptionalSchema(schemaName, async (db) => logTicketEvent(id, updatedBy, 'resolved', null, null, undefined, db));
    if (resolvedEvent) emitTicketEvent(tenantId, id, resolvedEvent);
    void dispatchWebhook(tenantId, 'ticket.resolved', {
      ticket: { id: ticket.id, title: ticket.title, resolvedAt: ticket.resolved_at },
    });
    if (data.resolution_notes) {
      void (async () => {
        const tenantInfo = await resolveTenantInfo(tenantId);
        const fullTicket = await getTicket(id, tenantInfo.schemaName);
        if (!fullTicket.contact_email) return;

        const ticketUrl = buildTenantUrl(tenantInfo.tenantSlug, `/portal/tickets/${id}`);
        void sendTicketResolvedEmail({
          tenantId,
          tenantSchema: tenantInfo.schemaName,
          tenantName: tenantInfo.tenantName,
          contactEmail: fullTicket.contact_email,
          contactName: fullTicket.contact_name ?? '',
          ticketNumber: fullTicket.ticket_number,
          ticketTitle: fullTicket.title,
          ticketPriority: fullTicket.priority,
          ticketUrl,
          resolutionNotes: data.resolution_notes!,
        });
      })().catch(() => {});
    }
    void (async () => {
      try {
        const tenantInfo = await resolveTenantInfo(tenantId);
        const schema = schemaName ?? tenantInfo.schemaName;
        const fullTicket = await getTicket(id, schema);
        if (!fullTicket.contact_email || !fullTicket.contact_id) return;

        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const safeSchema = schema.replace(/"/g, '""');
        await prisma.$executeRawUnsafe(
          `UPDATE "${safeSchema}".tickets
           SET csat_sent_at = NOW(),
               csat_expires_at = $1::timestamptz,
               updated_at = NOW()
           WHERE id = $2::uuid`,
          expiresAt.toISOString(),
          id,
        );

        const csatBaseUrl = buildTenantUrl(tenantInfo.tenantSlug, `/portal/tickets/${id}`);
        await sendTicketCsatEmail({
          tenantId,
          tenantSchema: schema,
          tenantName: tenantInfo.tenantName,
          contactEmail: fullTicket.contact_email,
          contactName: fullTicket.contact_name ?? '',
          ticketNumber: fullTicket.ticket_number,
          ticketTitle: fullTicket.title,
          csatBaseUrl,
        });
      } catch (err) {
        logger.error({ err }, '[TicketCsat] Failed to send CSAT email');
      }
    })();
    void (async () => {
      const resolvedSchemaName = schemaName ?? await resolveTenantSchemaName(tenantId);
      if (!resolvedSchemaName) return;
      await syncTicketToRedmine(tenantId, resolvedSchemaName, ticket.id, 'resolved');
    })().catch(() => {});
  }

  if (old.status !== 'closed' && ticket.status === 'closed') {
    const closedEvent = await withOptionalSchema(schemaName, async (db) => logTicketEvent(id, updatedBy, 'closed', null, null, undefined, db));
    if (closedEvent) emitTicketEvent(tenantId, id, closedEvent);
    void dispatchWebhook(tenantId, 'ticket.closed', {
      ticket: { id: ticket.id, title: ticket.title },
    });
    void (async () => {
      const resolvedSchemaName = schemaName ?? await resolveTenantSchemaName(tenantId);
      if (!resolvedSchemaName) return;
      await syncTicketToRedmine(tenantId, resolvedSchemaName, ticket.id, 'closed');
    })().catch(() => {});
  }

  void dispatchWebhook(tenantId, 'ticket.updated', {
    ticket: { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority, assignedTo: ticket.assigned_to },
  });
  void (async () => {
    const resolvedSchemaName = schemaName ?? await resolveTenantSchemaName(tenantId);
    if (!resolvedSchemaName) return;
    await syncTicketToRedmine(tenantId, resolvedSchemaName, ticket.id, 'updated');
  })().catch(() => {});

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:updated', { ticket });
  } catch { /* socket não inicializado em testes */ }

  return ticket;
}

/* ── deleteTicket ────────────────────────────────────────────────────────── */
export async function deleteTicket(id: string, deletedBy: string, tenantId: string, schemaName?: string) {
  const { attachments } = await withOptionalSchema(schemaName, async (db) => {
    await ensureTicketInfrastructure(db);
    const old = await getTicket(id, undefined, db);

    const attachments = await db.$queryRawUnsafe<Array<Pick<TicketAttachmentRow, 'id' | 'ticket_id' | 'filename'>>>(
      `SELECT id, ticket_id, filename
       FROM ticket_attachments
       WHERE ticket_id = $1::uuid`,
      id,
    );

    await db.$executeRawUnsafe(`DELETE FROM tickets WHERE id = $1::uuid`, id);

    await db.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data)
       VALUES ($1::uuid, 'ticket.deleted', 'ticket', $2::uuid, $3::jsonb)`,
      deletedBy,
      id,
      JSON.stringify(old),
    );

    return { attachments };
  });

  await Promise.allSettled(
    attachments.map((attachment) =>
      getStorage().delete(buildAttachmentStorageKey(attachment.ticket_id, attachment.id, attachment.filename)),
    ),
  );

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:deleted', { ticketId: id });
  } catch { /* socket não inicializado em testes */ }

  return { deleted: true, id };
}

/* ── assignTicket ────────────────────────────────────────────────────────── */
// TODO(Bloco A+1): assignTicket ainda seta assigned_to diretamente, sem passar
// por nenhuma regra de roteamento (assignRule). Migração para regras de
// atribuição (por tipo, carga, skill etc.) fica para uma próxima entrega.
export async function assignTicket(id: string, userId: string, assignedBy: string, tenantId: string) {
  await ensureTicketInfrastructure();
  const previous = await getTicket(id);
  const rows = await prisma.$queryRawUnsafe<TicketRow[]>(
    `UPDATE tickets SET assigned_to = $1::uuid, updated_at = NOW()
     WHERE id = $2::uuid
     RETURNING
       id, ticket_number, contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, email_message_id, title, description,
       status, waiting_reason, sla_paused_at, sla_paused_duration_seconds, escalated, escalated_at,
       csat_score, csat_comment, csat_sent_at, csat_responded_at, csat_expires_at, priority, category,
       assigned_to, department_id, resolved_at, resolution_notes, closed_at, due_date, tags, custom_fields, created_at, updated_at,
       NULL AS assignee_name, NULL AS assignee_avatar,
       NULL AS contact_name, NULL AS contact_email, NULL AS contact_phone, NULL AS contact_document, NULL AS organization_name,
       NULL AS type_name, NULL AS type_icon, NULL AS type_color, NULL AS department_name`,
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

/* ── claimTicketFromQueue ────────────────────────────────────────────────── */
export async function claimTicketFromQueue(
  ticketId: string,
  userId: string,
  tenantId: string,
  schemaName?: string,
) {
  // FOR UPDATE só tem efeito real dentro de uma transação de verdade. Ao
  // contrário de withOptionalSchema (que, sem schemaName, roda a query solta
  // via `runner(prisma)`, fora de transação), aqui forçamos $transaction em
  // ambos os caminhos para que o lock realmente sirva de proteção contra claim
  // concorrente.
  const runner = async (db: RawExecutor) => {
    await ensureTicketInfrastructure(db);

    // FOR UPDATE trava a linha pela duração da transação: uma segunda chamada
    // concorrente de claim para o mesmo ticket bloqueia aqui até a primeira
    // commitar, e então enxerga o status já atualizado — cai no ConflictError
    // abaixo em vez de reatribuir o ticket duas vezes.
    const currentRows = await db.$queryRawUnsafe<Array<{ status: string; department_id: string | null }>>(
      `SELECT status, department_id FROM tickets WHERE id = $1::uuid LIMIT 1 FOR UPDATE`,
      ticketId,
    );
    const current = currentRows[0];
    if (!current) throw new NotFoundError('Ticket');
    if (current.status !== 'queued') {
      throw new ConflictError('Ticket não está na fila');
    }

    if (current.department_id) {
      const belongs = await db.$queryRawUnsafe<Array<{ user_id: string }>>(
        `SELECT user_id FROM agent_departments
         WHERE department_id = $1::uuid AND user_id = $2::uuid
         LIMIT 1`,
        current.department_id,
        userId,
      );
      if (belongs.length === 0) {
        throw new ForbiddenError('Agente não pertence ao departamento deste ticket');
      }
    }

    const rows = await db.$queryRawUnsafe<TicketRow[]>(
      `UPDATE tickets
       SET assigned_to = $1::uuid,
           status = 'open',
           updated_at = NOW()
       WHERE id = $2::uuid
         AND status = 'queued'
       RETURNING
         id, ticket_number, contact_id, organization_id, conversation_id, source_conversation_id, type_id, source, email_message_id, title, description,
         status, waiting_reason, sla_paused_at, sla_paused_duration_seconds, escalated, escalated_at,
         csat_score, csat_comment, csat_sent_at, csat_responded_at, csat_expires_at, priority, category,
         assigned_to, department_id, resolved_at, resolution_notes, closed_at, due_date, tags, custom_fields, created_at, updated_at,
         NULL AS assignee_name, NULL AS assignee_avatar,
         NULL AS contact_name, NULL AS contact_email, NULL AS contact_phone, NULL AS contact_document, NULL AS organization_name,
         NULL AS type_name, NULL AS type_icon, NULL AS type_color, NULL AS department_name`,
      userId,
      ticketId,
    );

    // Defesa extra além do FOR UPDATE: se por algum motivo o status não era
    // mais 'queued' no momento do UPDATE, falha explicitamente em vez de
    // reatribuir silenciosamente.
    if (!rows[0]) throw new ConflictError('Ticket não está na fila');
    const ticket = rows[0];

    await db.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
       VALUES ($1::uuid, 'ticket.claimed_from_queue', 'ticket', $2::uuid, $3::jsonb, $4::jsonb)`,
      userId,
      ticketId,
      JSON.stringify({ status: 'queued' }),
      JSON.stringify({ status: 'open', assigned_to: userId }),
    );

    // TODO(first-response SLA / fetchLastEvent): quando o cálculo de tempo de
    // primeira resposta existir, pular tickets com status 'queued' — o
    // relógio de primeira resposta deve começar aqui (claim → 'open'), não em
    // 'created', já que o ticket ainda não foi visto por nenhum agente.
    const claimedEvent = await logTicketEvent(
      ticketId,
      userId,
      'claimed_from_queue',
      'queued',
      'open',
      undefined,
      db,
    );

    return { ticket, claimedEvent };
  };

  const { ticket, claimedEvent } = schemaName
    ? await withTenantSchema(schemaName, runner)
    : await prisma.$transaction(async (tx) => runner(tx as RawExecutor));

  if (claimedEvent) emitTicketEvent(tenantId, ticketId, claimedEvent);

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:updated', { ticket });
  } catch { /* socket não inicializado em testes */ }

  void dispatchWebhook(tenantId, 'ticket.updated', {
    ticket: { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority, assignedTo: ticket.assigned_to },
  });

  return ticket;
}

/* ── listComments ────────────────────────────────────────────────────────── */
export async function listComments(ticketId: string, schemaName?: string) {
  if (schemaName) {
    return withTenantSchema(schemaName, async (db) => {
      await getTicket(ticketId, undefined, db);

      const rows = await db.$queryRawUnsafe<CommentRow[]>(
        `SELECT
           tc.id, tc.ticket_id, tc.user_id, tc.contact_id, tc.source, tc.content, tc.is_internal, tc.created_at,
           COALESCE(c.name, u.name) AS author_name,
           COALESCE(c.avatar_url, u.avatar_url) AS author_avatar,
           COALESCE((
             SELECT json_agg(
               json_build_object(
                 'id', ta.id,
                 'filename', ta.filename,
                 'file_url', ta.file_url,
                 'mime_type', ta.mime_type
               )
               ORDER BY ta.created_at ASC
             )
             FROM ticket_attachments ta
             WHERE ta.comment_id = tc.id
           ), '[]'::json) AS attachments
         FROM ticket_comments tc
         LEFT JOIN users u ON u.id = tc.user_id
         LEFT JOIN contacts c ON c.id = tc.contact_id
         WHERE tc.ticket_id = $1::uuid
         ORDER BY tc.created_at ASC`,
        ticketId,
      );

      return rows.map((row) => ({
        ...row,
        attachments: Array.isArray(row.attachments) ? row.attachments : [],
      }));
    });
  }

  await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<CommentRow[]>(
    `SELECT
       tc.id, tc.ticket_id, tc.user_id, tc.contact_id, tc.source, tc.content, tc.is_internal, tc.created_at,
       COALESCE(c.name, u.name) AS author_name,
       COALESCE(c.avatar_url, u.avatar_url) AS author_avatar,
       COALESCE((
         SELECT json_agg(
           json_build_object(
             'id', ta.id,
             'filename', ta.filename,
             'file_url', ta.file_url,
             'mime_type', ta.mime_type
           )
           ORDER BY ta.created_at ASC
         )
         FROM ticket_attachments ta
         WHERE ta.comment_id = tc.id
       ), '[]'::json) AS attachments
     FROM ticket_comments tc
     LEFT JOIN users u ON u.id = tc.user_id
     LEFT JOIN contacts c ON c.id = tc.contact_id
     WHERE tc.ticket_id = $1::uuid
     ORDER BY tc.created_at ASC`,
    ticketId,
  );

  return rows.map((row) => ({
    ...row,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
  }));
}

/* ── addComment ──────────────────────────────────────────────────────────── */
export async function addComment(ticketId: string, data: CreateCommentInput, userId: string, tenantId: string) {
  const ticket = await getTicket(ticketId);

  const rows = await prisma.$queryRawUnsafe<CommentRow[]>(
    `INSERT INTO ticket_comments (ticket_id, user_id, contact_id, source, content, is_internal)
     VALUES ($1::uuid, $2::uuid, NULL, 'agent', $3, $4)
     RETURNING
       id, ticket_id, user_id, contact_id, source, content, is_internal, created_at,
       NULL AS author_name, NULL AS author_avatar,
       '[]'::json AS attachments`,
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
    io.to(`tenant:${tenantId}`).emit('ticket:comment_added', {
      ticketId,
      commentId: comment.id,
      authorId: userId,
      authorName: comment.author_name,
      isInternal: comment.is_internal,
      comment,
    });
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

  if (!data.is_internal) {
    void (async () => {
      const tenantInfo = await resolveTenantInfo(tenantId);
      const fullTicket = await getTicket(ticketId, tenantInfo.schemaName);
      if (!fullTicket.contact_email) return;

      const ticketUrl = buildTenantUrl(tenantInfo.tenantSlug, `/portal/tickets/${ticketId}`);
      void sendTicketCommentEmail({
        tenantId,
        tenantSchema: tenantInfo.schemaName,
        tenantName: tenantInfo.tenantName,
        contactEmail: fullTicket.contact_email,
        contactName: fullTicket.contact_name ?? '',
        ticketNumber: fullTicket.ticket_number,
        ticketTitle: fullTicket.title,
        ticketPriority: fullTicket.priority,
        ticketUrl,
        commentText: data.content,
      });
    })().catch(() => {});
  }

  void (async () => {
    const schemaName = await resolveTenantSchemaName(tenantId);
    if (!schemaName) return;
    const userRows = await prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
      `SELECT name FROM users WHERE id = $1::uuid LIMIT 1`,
      userId,
    );
    await syncCommentToRedmine(tenantId, schemaName, ticketId, {
      content: comment.content,
      authorName: userRows[0]?.name ?? 'Agente',
      isInternal: comment.is_internal,
    });
  })().catch(() => {});

  return comment;
}

/* ── deleteComment ───────────────────────────────────────────────────────── */
export async function updateComment(
  ticketId: string,
  commentId: string,
  data: UpdateCommentInput,
  userId: string,
  role: string,
  tenantId: string,
) {
  const rows = await prisma.$queryRawUnsafe<CommentRow[]>(
    `SELECT id, ticket_id, user_id, contact_id, source, content, is_internal, created_at,
            COALESCE(c.name, u.name) AS author_name,
            COALESCE(c.avatar_url, u.avatar_url) AS author_avatar,
            '[]'::json AS attachments
     FROM ticket_comments tc
     LEFT JOIN users u ON u.id = tc.user_id
     LEFT JOIN contacts c ON c.id = tc.contact_id
     WHERE tc.id = $1::uuid AND tc.ticket_id = $2::uuid
     LIMIT 1`,
    commentId,
    ticketId,
  );

  if (!rows[0]) throw new NotFoundError('Comentário');
  const comment = rows[0];
  const isAuthor = comment.user_id === userId;
  const isAdmin = role === 'owner' || role === 'admin';
  if (!isAuthor && !isAdmin) {
    throw new ForbiddenError('Você não pode editar este comentário');
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ticket_comments
     SET content = $1, updated_at = NOW()
     WHERE id = $2::uuid`,
    data.content.trim(),
    commentId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'ticket.comment_updated', 'ticket_comment', $2::uuid, $3::jsonb, $4::jsonb)`,
    userId,
    commentId,
    JSON.stringify(comment),
    JSON.stringify({ content: data.content.trim() }),
  );

  try {
    getSocketServer().to(`tenant:${tenantId}`).emit('ticket:comment_updated', {
      ticketId,
      commentId,
    });
  } catch { /* socket não inicializado em testes */ }

  return { success: true };
}

/* ── deleteComment ───────────────────────────────────────────────────────── */
export async function deleteComment(commentId: string, userId: string, role: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<CommentRow[]>(
    `SELECT id, ticket_id, user_id, contact_id, source, content, is_internal, created_at,
            NULL AS author_name, NULL AS author_avatar,
            '[]'::json AS attachments
     FROM ticket_comments
     WHERE id = $1::uuid LIMIT 1`,
    commentId,
  );

  if (!rows[0]) throw new NotFoundError('Comentário');
  const comment = rows[0];

  const isAuthor = comment.user_id === userId;
  const isAdmin = role === 'owner' || role === 'admin';
  if (!isAuthor && !isAdmin) throw new ForbiddenError('Você não pode excluir este comentário');

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
export async function listAttachments(ticketId: string, schemaName?: string): Promise<TicketAttachmentRow[]> {
  if (schemaName) {
    return withTenantSchema(schemaName, async (db) => {
      await ensureTicketInfrastructure(db);
      await getTicket(ticketId, undefined, db);

      const rows = await db.$queryRawUnsafe<TicketAttachmentRow[]>(
        `SELECT id, ticket_id, comment_id, user_id, filename, file_url, file_size, mime_type, created_at
         FROM ticket_attachments
         WHERE ticket_id = $1::uuid
         ORDER BY created_at DESC`,
        ticketId,
      );

      return rows;
    });
  }

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
  schemaName?: string;
}): Promise<TicketAttachmentRow> {
  if (!ALLOWED_ATTACHMENT_MIME.has(params.mimeType)) {
    throw new ForbiddenError('Tipo de arquivo não permitido');
  }

  if (params.buffer.length > MAX_ATTACHMENT_SIZE) {
    throw new PayloadTooLargeError('Arquivo excede o limite de 10MB');
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
  const key = buildAttachmentStorageKey(params.ticketId, attachmentId, safeName);
  await getStorage().upload(key, params.buffer, params.mimeType);

  const fileUrl = `/api/tickets/attachments/${attachmentId}/content`;

  return withOptionalSchema(params.schemaName, async (db) => {
    await ensureTicketInfrastructure(db);
    await getTicket(params.ticketId, undefined, db);

    if (params.commentId) {
      const commentRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
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

    const rows = await db.$queryRawUnsafe<TicketAttachmentRow[]>(
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
  });
}

export async function deleteAttachment(attachmentId: string, userId: string, schemaName?: string): Promise<{ deleted: true }> {
  const attachment = await withOptionalSchema(schemaName, async (db) => {
    await ensureTicketInfrastructure(db);

    const rows = await db.$queryRawUnsafe<TicketAttachmentRow[]>(
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

    await db.$executeRawUnsafe(
      `DELETE FROM ticket_attachments
       WHERE id = $1::uuid`,
      attachmentId,
    );

    return attachment;
  });

  const key = buildAttachmentStorageKey(attachment.ticket_id, attachment.id, attachment.filename);
  await getStorage().delete(key).catch(() => undefined);

  return { deleted: true };
}

export async function readAttachmentContent(attachmentId: string, schemaName?: string): Promise<{
  mimeType: string;
  filename: string;
  content: Buffer;
}> {
  const attachment = await withOptionalSchema(schemaName, async (db) => {
    await ensureTicketInfrastructure(db);

    const rows = await db.$queryRawUnsafe<TicketAttachmentRow[]>(
      `SELECT id, ticket_id, comment_id, user_id, filename, file_url, file_size, mime_type, created_at
       FROM ticket_attachments
       WHERE id = $1::uuid
       LIMIT 1`,
      attachmentId,
    );

    const attachment = rows[0];
    if (!attachment) throw new NotFoundError('Anexo');
    return attachment;
  });

  const key = buildAttachmentStorageKey(attachment.ticket_id, attachment.id, attachment.filename);
  let content: Buffer;
  try {
    content = await getStorage().download(key);
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      throw new NotFoundError('Arquivo do anexo');
    }
    throw error;
  }

  return {
    mimeType: attachment.mime_type ?? 'application/octet-stream',
    filename: attachment.filename,
    content,
  };
}

/* ── checklist ───────────────────────────────────────────────────────────── */
export async function listChecklistItems(ticketId: string, schemaName?: string): Promise<TicketChecklistRow[]> {
  if (schemaName) {
    return withTenantSchema(schemaName, async (db) => {
      await ensureTicketInfrastructure(db);
      await getTicket(ticketId, undefined, db);

      const rows = await db.$queryRawUnsafe<TicketChecklistRow[]>(
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
    });
  }

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
export async function listTimeEntries(ticketId: string, schemaName?: string): Promise<TicketTimeEntryRow[]> {
  if (schemaName) {
    return withTenantSchema(schemaName, async (db) => {
      await ensureTicketInfrastructure(db);
      await getTicket(ticketId, undefined, db);

      const rows = await db.$queryRawUnsafe<TicketTimeEntryRow[]>(
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
    });
  }

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
export async function getTicketTimeline(ticketId: string, schemaName?: string) {
  if (schemaName) {
    return withTenantSchema(schemaName, async (db) => {
      await ensureTicketInfrastructure(db);
      await getTicket(ticketId, undefined, db);

      const rows = await db.$queryRawUnsafe<TicketEventRow[]>(
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
    });
  }

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
