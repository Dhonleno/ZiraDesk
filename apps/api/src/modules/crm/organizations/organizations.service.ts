import { prisma } from '../../../config/database.js';
import type { CreateOrganizationInput, UpdateOrganizationInput, ListOrganizationsQuery } from './organizations.schema.js';

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

interface OrgRow {
  id: string;
  type: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  segment: string | null;
  lead_source: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  tags: string[];
  custom_fields: unknown;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  contacts_count: bigint;
  conversations_count: bigint;
  tickets_count: bigint;
}

interface OrgStatsRow {
  total_contacts: bigint;
  total_conversations: bigint;
  open_conversations: bigint;
  total_tickets: bigint;
  open_tickets: bigint;
  last_contact_at: Date | null;
}

interface OrganizationConflictRow {
  id: string;
  name: string;
}

function toPgArray(arr: string[]): string {
  if (!arr.length) return '{}';
  return '{' + arr.map(t => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',') + '}';
}

function normalizeDocumentForComparison(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits || null;
}

function normalizeEmailForComparison(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

async function assertUniqueOrganizationDocument(document: string | null, ignoreOrganizationId?: string): Promise<void> {
  if (!document) return;

  const rows = await prisma.$queryRawUnsafe<OrganizationConflictRow[]>(
    `SELECT id, name
     FROM organizations
     WHERE ($1::uuid IS NULL OR id != $1::uuid)
       AND regexp_replace(COALESCE(document, ''), '\\D', '', 'g') = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    ignoreOrganizationId ?? null,
    document,
  );

  if (rows[0]) {
    throw new ConflictError(`Já existe uma organização com este CPF/CNPJ (${rows[0].name}).`);
  }
}

async function assertUniqueOrganizationEmail(email: string | null, ignoreOrganizationId?: string): Promise<void> {
  if (!email) return;

  const rows = await prisma.$queryRawUnsafe<OrganizationConflictRow[]>(
    `SELECT id, name
     FROM organizations
     WHERE ($1::uuid IS NULL OR id != $1::uuid)
       AND lower(trim(COALESCE(email, ''))) = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    ignoreOrganizationId ?? null,
    email,
  );

  if (rows[0]) {
    throw new ConflictError(`E-mail já cadastrado para outra organização (${rows[0].name}).`);
  }
}

const SORT_COLUMNS: Record<string, string> = {
  name:       'o.name',
  created_at: 'o.created_at',
  updated_at: 'o.updated_at',
};

const BASE_SELECT = `
  SELECT
    o.id, o.type, o.name, o.document, o.email, o.phone, o.website, o.status,
    o.address_street, o.address_city, o.address_state, o.address_zip,
    o.segment, o.lead_source, o.responsible_id, o.tags, o.custom_fields,
    o.notes, o.created_at, o.updated_at,
    u.name AS responsible_name,
    COUNT(DISTINCT c.id)    AS contacts_count,
    COUNT(DISTINCT conv.id) AS conversations_count,
    COUNT(DISTINCT t.id)    AS tickets_count
  FROM organizations o
  LEFT JOIN users u        ON u.id = o.responsible_id
  LEFT JOIN contacts c     ON c.organization_id = o.id
  LEFT JOIN conversations conv ON conv.organization_id = o.id
  LEFT JOIN tickets t      ON t.organization_id = o.id`;

/* ── listOrganizations ───────────────────────────────────────────────────── */
export async function listOrganizations(query: ListOrganizationsQuery) {
  const { page, per_page, search, status, segment, responsible_id, tag, sort_by, sort_order } = query;
  const offset = (page - 1) * per_page;

  const sortCol = SORT_COLUMNS[sort_by] ?? 'o.created_at';
  const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

  const rows = await prisma.$queryRawUnsafe<OrgRow[]>(
    `${BASE_SELECT}
     WHERE ($1::text IS NULL OR o.name ILIKE '%' || $1 || '%'
                             OR o.email ILIKE '%' || $1 || '%'
                             OR o.document ILIKE '%' || $1 || '%'
                             OR o.phone ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR o.status = $2)
       AND ($3::text IS NULL OR o.segment = $3)
       AND ($4::uuid IS NULL OR o.responsible_id = $4::uuid)
       AND ($5::text IS NULL OR $5 = ANY(o.tags))
     GROUP BY o.id, u.name
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $6 OFFSET $7`,
    search ?? null, status ?? null, segment ?? null,
    responsible_id ?? null, tag ?? null,
    per_page, offset,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count FROM organizations o
     WHERE ($1::text IS NULL OR o.name ILIKE '%' || $1 || '%'
                             OR o.email ILIKE '%' || $1 || '%'
                             OR o.document ILIKE '%' || $1 || '%'
                             OR o.phone ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR o.status = $2)
       AND ($3::text IS NULL OR o.segment = $3)
       AND ($4::uuid IS NULL OR o.responsible_id = $4::uuid)
       AND ($5::text IS NULL OR $5 = ANY(o.tags))`,
    search ?? null, status ?? null, segment ?? null,
    responsible_id ?? null, tag ?? null,
  );

  const total = Number(countRows[0]?.count ?? 0);
  return {
    data: rows.map(r => ({ ...r, contacts_count: Number(r.contacts_count), conversations_count: Number(r.conversations_count), tickets_count: Number(r.tickets_count) })),
    meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
  };
}

/* ── getOrganization ─────────────────────────────────────────────────────── */
export async function getOrganization(id: string) {
  const rows = await prisma.$queryRawUnsafe<OrgRow[]>(
    `${BASE_SELECT}
     WHERE o.id = $1::uuid
     GROUP BY o.id, u.name
     LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Organização');
  const r = rows[0];
  return { ...r, contacts_count: Number(r.contacts_count), conversations_count: Number(r.conversations_count), tickets_count: Number(r.tickets_count) };
}

/* ── getOrganizationStats ────────────────────────────────────────────────── */
export async function getOrganizationStats(id: string) {
  await getOrganization(id);

  const [stats] = await prisma.$queryRawUnsafe<OrgStatsRow[]>(
    `SELECT
       COUNT(DISTINCT c.id)                                                   AS total_contacts,
       COUNT(DISTINCT conv.id)                                                AS total_conversations,
       COUNT(DISTINCT conv.id) FILTER (WHERE conv.status IN ('open','pending','in_service')) AS open_conversations,
       COUNT(DISTINCT t.id)                                                   AS total_tickets,
       COUNT(DISTINCT t.id)    FILTER (WHERE t.status NOT IN ('resolved','closed')) AS open_tickets,
       MAX(m.created_at)                                                      AS last_contact_at
     FROM organizations o
     LEFT JOIN contacts c         ON c.organization_id = o.id
     LEFT JOIN conversations conv ON conv.organization_id = o.id
     LEFT JOIN tickets t          ON t.organization_id = o.id
     LEFT JOIN messages m         ON m.conversation_id = conv.id
     WHERE o.id = $1::uuid`,
    id,
  );

  return {
    total_contacts:       Number(stats?.total_contacts ?? 0),
    total_conversations:  Number(stats?.total_conversations ?? 0),
    open_conversations:   Number(stats?.open_conversations ?? 0),
    total_tickets:        Number(stats?.total_tickets ?? 0),
    open_tickets:         Number(stats?.open_tickets ?? 0),
    last_contact_at:      stats?.last_contact_at ?? null,
  };
}

/* ── getOrganizationContacts ─────────────────────────────────────────────── */
export async function getOrganizationContacts(id: string) {
  await getOrganization(id);
  return prisma.$queryRawUnsafe<Array<{ id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null; role: string | null; is_primary: boolean; created_at: Date }>>(
    `SELECT id, name, email, phone, whatsapp, role, is_primary, created_at
     FROM contacts WHERE organization_id = $1::uuid ORDER BY is_primary DESC, name ASC`,
    id,
  );
}

/* ── getOrganizationConversations ────────────────────────────────────────── */
export async function getOrganizationConversations(id: string) {
  await getOrganization(id);
  return prisma.$queryRawUnsafe<Array<{ id: string; status: string; subject: string | null; last_message: string | null; created_at: Date }>>(
    `SELECT id, status, subject, last_message, created_at
     FROM conversations WHERE organization_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
    id,
  );
}

/* ── getOrganizationTickets ──────────────────────────────────────────────── */
export async function getOrganizationTickets(id: string) {
  await getOrganization(id);
  return prisma.$queryRawUnsafe<Array<{ id: string; title: string; status: string; priority: string; created_at: Date }>>(
    `SELECT id, title, status, priority, created_at
     FROM tickets WHERE organization_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
    id,
  );
}

/* ── createOrganization ──────────────────────────────────────────────────── */
export async function createOrganization(data: CreateOrganizationInput, createdBy: string) {
  const normalizedEmail = normalizeEmailForComparison(data.email ?? null);
  const normalizedDocument = normalizeDocumentForComparison(data.document ?? null);
  await assertUniqueOrganizationEmail(normalizedEmail);
  await assertUniqueOrganizationDocument(normalizedDocument);

  const tagsLiteral    = toPgArray(data.tags ?? []);
  const customFieldsJson = JSON.stringify(data.custom_fields ?? {});

  const rows = await prisma.$queryRawUnsafe<OrgRow[]>(
    `INSERT INTO organizations (
       type, name, document, email, phone, website, status,
       address_street, address_city, address_state, address_zip,
       segment, lead_source, responsible_id, tags, custom_fields, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid, $15::text[], $16::jsonb, $17)
     RETURNING *`,
    data.type ?? 'company', data.name, normalizedDocument, normalizedEmail,
    data.phone ?? null, data.website ?? null, data.status ?? 'lead',
    data.address_street ?? null, data.address_city ?? null, data.address_state ?? null, data.address_zip ?? null,
    data.segment ?? null, data.lead_source ?? null, data.responsible_id ?? null,
    tagsLiteral, customFieldsJson, data.notes ?? null,
  );

  const org = rows[0]!;

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'organization.created', 'organization', $2::uuid, $3::jsonb)`,
    createdBy, org.id, JSON.stringify(org),
  );

  return org;
}

/* ── updateOrganization ──────────────────────────────────────────────────── */
export async function updateOrganization(id: string, data: UpdateOrganizationInput, updatedBy: string) {
  const existing = await getOrganization(id);
  const normalizedEmail = data.email === undefined ? undefined : normalizeEmailForComparison(data.email);
  const normalizedDocument = data.document === undefined ? undefined : normalizeDocumentForComparison(data.document);

  if (normalizedEmail !== undefined) {
    await assertUniqueOrganizationEmail(normalizedEmail, id);
  }
  if (normalizedDocument !== undefined) {
    await assertUniqueOrganizationDocument(normalizedDocument, id);
  }

  const tagsLiteral    = data.tags !== undefined ? toPgArray(data.tags) : null;
  const customFieldsJson = data.custom_fields !== undefined ? JSON.stringify(data.custom_fields) : null;

  const rows = await prisma.$queryRawUnsafe<OrgRow[]>(
    `UPDATE organizations SET
       type            = COALESCE($1,          type),
       name            = COALESCE($2,          name),
       document        = COALESCE($3,          document),
       email           = COALESCE($4,          email),
       phone           = COALESCE($5,          phone),
       website         = COALESCE($6,          website),
       status          = COALESCE($7,          status),
       address_street  = COALESCE($8,          address_street),
       address_city    = COALESCE($9,          address_city),
       address_state   = COALESCE($10,         address_state),
       address_zip     = COALESCE($11,         address_zip),
       segment         = COALESCE($12,         segment),
       lead_source     = COALESCE($13,         lead_source),
       responsible_id  = COALESCE($14::uuid,   responsible_id),
       tags            = COALESCE($15::text[], tags),
       custom_fields   = COALESCE($16::jsonb,  custom_fields),
       notes           = COALESCE($17,         notes),
       updated_at      = NOW()
     WHERE id = $18::uuid
     RETURNING *`,
    data.type ?? null, data.name ?? null, normalizedDocument ?? null, normalizedEmail ?? null,
    data.phone ?? null, data.website ?? null, data.status ?? null,
    data.address_street ?? null, data.address_city ?? null, data.address_state ?? null, data.address_zip ?? null,
    data.segment ?? null, data.lead_source ?? null, data.responsible_id ?? null,
    tagsLiteral, customFieldsJson, data.notes ?? null, id,
  );

  if (!rows[0]) throw new NotFoundError('Organização');
  const updated = rows[0];

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'organization.updated', 'organization', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy, id, JSON.stringify(existing), JSON.stringify(updated),
  );

  return updated;
}

/* ── deleteOrganization ──────────────────────────────────────────────────── */
export async function deleteOrganization(id: string, deletedBy: string) {
  const existing = await getOrganization(id);

  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET status = 'inactive', updated_at = NOW() WHERE id = $1::uuid`, id,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data)
     VALUES ($1::uuid, 'organization.deleted', 'organization', $2::uuid, $3::jsonb)`,
    deletedBy, id, JSON.stringify(existing),
  );

  return { ...existing, status: 'inactive' };
}
