import { prisma } from '../../../config/database.js';
import type { CreateClientInput, UpdateClientInput, ListClientsQuery } from './clients.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

interface ClientRow {
  id: string;
  type: string;
  name: string;
  email: string | null;
  phone: string | null;
  document: string | null;
  website: string | null;
  status: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  birth_date: Date | null;
  gender: string | null;
  occupation: string | null;
  income: number | null;
  segment: string | null;
  lead_source: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  responsible_email: string | null;
  tags: string[];
  custom_fields: unknown;
  created_at: Date;
  updated_at: Date;
  last_contact_at: Date | null;
}

interface AuditLogRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  old_data: unknown;
  new_data: unknown;
  created_at: Date;
}

interface ConversationRow {
  id: string;
  status: string;
  subject: string | null;
  last_message: string | null;
  created_at: Date;
}

interface TicketRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: Date;
}

interface ClientStatsRow {
  client_exists: boolean;
  total_conversations: bigint;
  open_conversations: bigint;
  total_tickets: bigint;
  open_tickets: bigint;
  total_messages: bigint;
  last_contact_at: Date | null;
}

function toPgArray(arr: string[]): string {
  return '{' + arr.map(t => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',') + '}';
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// ── Valid sort column whitelist (prevents SQL injection) ──────────────────────
const SORT_COLUMNS: Record<string, string> = {
  name: 'c.name',
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
  last_contact: 'last_msg.created_at',
};

export async function listClients(query: ListClientsQuery) {
  const { page, per_page, search, status, type, responsible_id, tag, segment, sort_by, sort_order } =
    query;
  const offset = (page - 1) * per_page;

  const searchParam = search ?? null;
  const statusParam = status ?? null;
  const typeParam = type ?? null;
  const responsibleParam = responsible_id ?? null;
  const tagParam = tag ?? null;
  const segmentParam = segment ?? null;

  const sortCol = SORT_COLUMNS[sort_by] ?? 'c.created_at';
  const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

  const rows = await prisma.$queryRawUnsafe<ClientRow[]>(
    `SELECT
       c.id, c.type, c.name, c.email, c.phone, c.document, c.website, c.status,
       c.address_street, c.address_city, c.address_state, c.address_zip,
       c.birth_date, c.gender, c.occupation, c.income, c.segment, c.lead_source,
       c.responsible_id, c.tags, c.custom_fields, c.created_at, c.updated_at,
       u.name AS responsible_name, u.email AS responsible_email,
       last_msg.created_at AS last_contact_at
     FROM clients c
     LEFT JOIN users u ON u.id = c.responsible_id
     LEFT JOIN LATERAL (
       SELECT m.created_at FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       WHERE cv.client_id = c.id
       ORDER BY m.created_at DESC LIMIT 1
     ) last_msg ON true
     WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%'
                              OR c.email ILIKE '%' || $1 || '%'
                              OR c.phone ILIKE '%' || $1 || '%'
                              OR c.document ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR c.status = $2)
       AND ($3::text IS NULL OR c.type = $3)
       AND ($4::uuid IS NULL OR c.responsible_id = $4::uuid)
       AND ($5::text IS NULL OR $5 = ANY(c.tags))
       AND ($6::text IS NULL OR c.segment = $6)
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $7 OFFSET $8`,
    searchParam,
    statusParam,
    typeParam,
    responsibleParam,
    tagParam,
    segmentParam,
    per_page,
    offset,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM clients c
     WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%'
                              OR c.email ILIKE '%' || $1 || '%'
                              OR c.phone ILIKE '%' || $1 || '%'
                              OR c.document ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR c.status = $2)
       AND ($3::text IS NULL OR c.type = $3)
       AND ($4::uuid IS NULL OR c.responsible_id = $4::uuid)
       AND ($5::text IS NULL OR $5 = ANY(c.tags))
       AND ($6::text IS NULL OR c.segment = $6)`,
    searchParam,
    statusParam,
    typeParam,
    responsibleParam,
    tagParam,
    segmentParam,
  );

  const total = Number(countRows[0]?.count ?? 0);
  return {
    data: rows,
    meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
  };
}

export async function getClient(id: string) {
  const rows = await prisma.$queryRawUnsafe<ClientRow[]>(
    `SELECT
       c.id, c.type, c.name, c.email, c.phone, c.document, c.website, c.status,
       c.address_street, c.address_city, c.address_state, c.address_zip,
       c.birth_date, c.gender, c.occupation, c.income, c.segment, c.lead_source,
       c.responsible_id, c.tags, c.custom_fields, c.created_at, c.updated_at,
       u.id AS responsible_id, u.name AS responsible_name, u.email AS responsible_email
     FROM clients c
     LEFT JOIN users u ON u.id = c.responsible_id
	     WHERE c.id = $1::uuid
	     LIMIT 1`,
	    id,
	  );
  if (!rows[0]) throw new NotFoundError('Cliente');
  return rows[0];
}

export async function createClient(data: CreateClientInput, createdBy: string) {
  if (data.email) {
    const existing = await prisma.$queryRawUnsafe<[{ id: string }]>(
      `SELECT id FROM clients WHERE email = $1 LIMIT 1`,
      data.email,
    );
    if (existing[0]) throw new ConflictError('E-mail já cadastrado para outro cliente');
  }

  const tagsLiteral = toPgArray(data.tags ?? []);
  const customFieldsJson = JSON.stringify(data.custom_fields ?? {});

  const rows = await prisma.$queryRawUnsafe<ClientRow[]>(
    `INSERT INTO clients (
       type, name, email, phone, document, website, status,
       address_street, address_city, address_state, address_zip,
       birth_date, gender, occupation, income, segment, lead_source,
       responsible_id, tags, custom_fields
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11,
       $12::date, $13, $14, $15, $16, $17,
       $18::uuid, $19::text[], $20::jsonb
     )
     RETURNING *`,
    data.type ?? 'person',
    data.name,
    data.email ?? null,
    data.phone ?? null,
    data.document ?? null,
    data.website ?? null,
    data.status ?? 'lead',
    data.address_street ?? null,
    data.address_city ?? null,
    data.address_state ?? null,
    data.address_zip ?? null,
    data.birth_date ?? null,
    data.gender ?? null,
    data.occupation ?? null,
    data.income ?? null,
    data.segment ?? null,
    data.lead_source ?? null,
    data.responsible_id ?? null,
    tagsLiteral,
    customFieldsJson,
  );

  const client = rows[0]!;

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'client.created', 'client', $2::uuid, $3::jsonb)`,
    createdBy,
    client.id,
    JSON.stringify(client),
  );

  return client;
}

export async function updateClient(id: string, data: UpdateClientInput, updatedBy: string) {
  const existing = await getClient(id);

  if (data.email && data.email !== existing.email) {
    const emailCheck = await prisma.$queryRawUnsafe<[{ id: string }]>(
	      `SELECT id FROM clients WHERE email = $1 AND id != $2::uuid LIMIT 1`,
	      data.email,
	      id,
	    );
    if (emailCheck[0]) throw new ConflictError('E-mail já cadastrado para outro cliente');
  }

  const tagsLiteral = data.tags !== undefined ? toPgArray(data.tags) : null;
  const customFieldsJson = data.custom_fields !== undefined ? JSON.stringify(data.custom_fields) : null;

  const rows = await prisma.$queryRawUnsafe<ClientRow[]>(
    `UPDATE clients SET
       type            = COALESCE($1,            type),
       name            = COALESCE($2,            name),
       email           = COALESCE($3,            email),
       phone           = COALESCE($4,            phone),
       document        = COALESCE($5,            document),
       website         = COALESCE($6,            website),
       status          = COALESCE($7,            status),
       address_street  = COALESCE($8,            address_street),
       address_city    = COALESCE($9,            address_city),
       address_state   = COALESCE($10,           address_state),
       address_zip     = COALESCE($11,           address_zip),
       birth_date      = COALESCE($12::date,     birth_date),
       gender          = COALESCE($13,           gender),
       occupation      = COALESCE($14,           occupation),
       income          = COALESCE($15,           income),
       segment         = COALESCE($16,           segment),
       lead_source     = COALESCE($17,           lead_source),
       responsible_id  = COALESCE($18::uuid,     responsible_id),
       tags            = COALESCE($19::text[],   tags),
       custom_fields   = COALESCE($20::jsonb,    custom_fields),
       updated_at      = NOW()
	     WHERE id = $21::uuid
	     RETURNING *`,
    data.type ?? null,
    data.name ?? null,
    data.email ?? null,
    data.phone ?? null,
    data.document ?? null,
    data.website ?? null,
    data.status ?? null,
    data.address_street ?? null,
    data.address_city ?? null,
    data.address_state ?? null,
    data.address_zip ?? null,
    data.birth_date ?? null,
    data.gender ?? null,
    data.occupation ?? null,
    data.income ?? null,
    data.segment ?? null,
    data.lead_source ?? null,
    data.responsible_id ?? null,
    tagsLiteral,
    customFieldsJson,
    id,
  );

  const updated = rows[0]!;

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'client.updated', 'client', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy,
    id,
    JSON.stringify(existing),
    JSON.stringify(updated),
  );

  return updated;
}

export async function deleteClient(id: string, deletedBy: string) {
  const existing = await getClient(id);

  const rows = await prisma.$queryRawUnsafe<ClientRow[]>(
    `UPDATE clients SET status = 'inativo', updated_at = NOW()
	     WHERE id = $1::uuid
	     RETURNING *`,
	    id,
	  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data)
     VALUES ($1::uuid, 'client.deleted', 'client', $2::uuid, $3::jsonb)`,
    deletedBy,
    id,
    JSON.stringify(existing),
  );

  return rows[0]!;
}

export async function getClientTimeline(id: string) {
  await getClient(id);

  const [auditLogs, conversations, tickets] = await Promise.all([
    prisma.$queryRawUnsafe<AuditLogRow[]>(
      `SELECT id, action, entity, entity_id, old_data, new_data, created_at
       FROM audit_logs
       WHERE entity = 'client' AND entity_id = $1::uuid
       ORDER BY created_at DESC`,
      id,
    ),
    prisma.$queryRawUnsafe<ConversationRow[]>(
      `SELECT id, status, subject, last_message, created_at
       FROM conversations
       WHERE client_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 20`,
      id,
    ),
    prisma.$queryRawUnsafe<TicketRow[]>(
      `SELECT id, title, status, priority, created_at
       FROM tickets
       WHERE client_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 20`,
      id,
    ),
  ]);

  type TimelineEvent = {
    id: string;
    type: 'audit' | 'conversation' | 'ticket';
    title: string;
    subtitle: string | null;
    time: Date;
    dot_color: string;
  };

  const events: TimelineEvent[] = [];

  for (const log of auditLogs) {
    const colorMap: Record<string, string> = {
      'client.created': '#00C9A7',
      'client.updated': '#60A5FA',
      'client.deleted': '#F87171',
    };
    events.push({
      id: log.id,
      type: 'audit',
      title: log.action,
      subtitle: null,
      time: log.created_at,
      dot_color: colorMap[log.action] ?? '#9DA3AE',
    });
  }

  for (const conv of conversations) {
    const statusColorMap: Record<string, string> = {
      open: '#F59E0B',
      in_service: '#60A5FA',
      resolved: '#3ECF8E',
    };
    events.push({
      id: conv.id,
      type: 'conversation',
      title: conv.subject ?? 'Conversa',
      subtitle: conv.last_message,
      time: conv.created_at,
      dot_color: statusColorMap[conv.status] ?? '#9DA3AE',
    });
  }

  for (const ticket of tickets) {
    const priorityColorMap: Record<string, string> = {
      low: '#9DA3AE',
      medium: '#F59E0B',
      high: '#F87171',
      urgent: '#A78BFA',
    };
    events.push({
      id: ticket.id,
      type: 'ticket',
      title: ticket.title,
      subtitle: `${ticket.status} · ${ticket.priority}`,
      time: ticket.created_at,
      dot_color: priorityColorMap[ticket.priority] ?? '#9DA3AE',
    });
  }

  events.sort((a, b) => b.time.getTime() - a.time.getTime());

  return events;
}

export async function getClientStats(id: string, tenantId?: string) {
  if (!tenantId) {
    await getClient(id);
  }

  const tenant = tenantId
    ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true } })
    : null;
  const schemaPrefix = tenant ? `${quoteIdent(tenant.schemaName)}.` : '';

  if (tenantId && !tenant) throw new NotFoundError('Tenant');

  const [stats] = await prisma.$queryRawUnsafe<ClientStatsRow[]>(
    `WITH client_row AS (
       SELECT id FROM ${schemaPrefix}clients WHERE id = $1::uuid
     ),
     conv_stats AS (
       SELECT
         COUNT(*) AS total_conversations,
         COUNT(*) FILTER (WHERE status IN ('open', 'in_service')) AS open_conversations
       FROM ${schemaPrefix}conversations
       WHERE client_id = $1::uuid
     ),
     ticket_stats AS (
       SELECT
         COUNT(*) AS total_tickets,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) AS open_tickets
       FROM ${schemaPrefix}tickets
       WHERE client_id = $1::uuid
     ),
     msg_stats AS (
       SELECT COUNT(m.*) AS total_messages, MAX(m.created_at) AS last_contact_at
       FROM ${schemaPrefix}messages m
       JOIN ${schemaPrefix}conversations c ON c.id = m.conversation_id
       WHERE c.client_id = $1::uuid
     )
     SELECT
       EXISTS(SELECT 1 FROM client_row) AS client_exists,
       conv_stats.total_conversations,
       conv_stats.open_conversations,
       ticket_stats.total_tickets,
       ticket_stats.open_tickets,
       msg_stats.total_messages,
       msg_stats.last_contact_at
     FROM conv_stats, ticket_stats, msg_stats`,
    id,
  );

  if (!stats?.client_exists) throw new NotFoundError('Cliente');

  return {
    total_conversations: Number(stats.total_conversations ?? 0),
    open_conversations: Number(stats.open_conversations ?? 0),
    total_tickets: Number(stats.total_tickets ?? 0),
    open_tickets: Number(stats.open_tickets ?? 0),
    total_messages: Number(stats.total_messages ?? 0),
    last_contact_at: stats.last_contact_at ?? null,
  };
}

export async function addTag(clientId: string, tag: string) {
  const client = await getClient(clientId);
  if (client.tags.includes(tag)) return client;

  const rows = await prisma.$queryRawUnsafe<ClientRow[]>(
    `UPDATE clients
     SET tags = array_append(tags, $1), updated_at = NOW()
	     WHERE id = $2::uuid
	     RETURNING *`,
	    tag,
	    clientId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (action, entity, entity_id, new_data)
     VALUES ('client.tag_added', 'client', $1::uuid, $2::jsonb)`,
    clientId,
    JSON.stringify({ tag }),
  );

  return rows[0]!;
}

export async function removeTag(clientId: string, tag: string) {
  const client = await getClient(clientId);
  if (!client.tags.includes(tag)) throw new NotFoundError('Tag não encontrada');

  const rows = await prisma.$queryRawUnsafe<ClientRow[]>(
    `UPDATE clients
     SET tags = array_remove(tags, $1), updated_at = NOW()
	     WHERE id = $2::uuid
	     RETURNING *`,
	    tag,
	    clientId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (action, entity, entity_id, old_data)
     VALUES ('client.tag_removed', 'client', $1::uuid, $2::jsonb)`,
    clientId,
    JSON.stringify({ tag }),
  );

  return rows[0]!;
}
