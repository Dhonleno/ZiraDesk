import { prisma } from '../../../config/database.js';
import { type RawExecutor, withOptionalSchema } from '../crm.db.js';
import type {
  BulkDeleteOrganizationsInput,
  CountOrganizationsQuery,
  CreateOrganizationInput,
  ListOrganizationsQuery,
  UpdateOrganizationInput,
} from './organizations.schema.js';
import { maskDocument, maskEmail, maskPhone } from '../../../utils/pii-mask.js';
import { buildOrganizationFilterWhere } from './organization-filter.js';

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

interface PaginationMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface OrganizationSummary extends Omit<OrgRow, 'contacts_count' | 'conversations_count' | 'tickets_count'> {
  contacts_count: number;
  conversations_count: number;
  tickets_count: number;
}

interface OrganizationStatsResult {
  total_contacts: number;
  total_conversations: number;
  open_conversations: number;
  total_tickets: number;
  open_tickets: number;
  last_contact_at: Date | null;
}

type OrganizationContactListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  role: string | null;
  is_primary: boolean;
  created_at: Date;
};

export function maskOrganizationRecord(org: OrganizationSummary): OrganizationSummary {
  return {
    ...org,
    email: maskEmail(org.email),
    phone: maskPhone(org.phone),
    document: maskDocument(org.document),
  };
}

export function maskOrganizationListRecords(orgs: OrganizationSummary[]): OrganizationSummary[] {
  return orgs.map(maskOrganizationRecord);
}

export function maskOrganizationContactRecords(contacts: OrganizationContactListItem[]): OrganizationContactListItem[] {
  return contacts.map((contact) => ({
    ...contact,
    email: maskEmail(contact.email),
    phone: maskPhone(contact.phone),
    whatsapp: maskPhone(contact.whatsapp),
  }));
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

async function assertUniqueOrganizationDocument(
  document: string | null,
  ignoreOrganizationId?: string,
  db: RawExecutor = prisma,
): Promise<void> {
  if (!document) return;

  const rows = await db.$queryRawUnsafe<OrganizationConflictRow[]>(
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

async function assertUniqueOrganizationEmail(
  email: string | null,
  ignoreOrganizationId?: string,
  db: RawExecutor = prisma,
): Promise<void> {
  if (!email) return;

  const rows = await db.$queryRawUnsafe<OrganizationConflictRow[]>(
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
export async function listOrganizations(
  query: ListOrganizationsQuery,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<{ data: OrganizationSummary[]; meta: PaginationMeta }> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => listOrganizations(query, undefined, tx));
  }

  const { page, per_page, search, status, segment, responsible_id, tag, sort_by, sort_order } = query;
  const offset = (page - 1) * per_page;

  const sortCol = SORT_COLUMNS[sort_by] ?? 'o.created_at';
  const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

  const rows = await db.$queryRawUnsafe<OrgRow[]>(
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

  const countRows = await db.$queryRawUnsafe<[{ count: bigint }]>(
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

export async function countOrganizationsByFilter(
  filter: CountOrganizationsQuery,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<number> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => countOrganizationsByFilter(filter, undefined, tx));
  }

  const where = buildOrganizationFilterWhere({ filter });
  const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count
     FROM organizations o
     WHERE ${where.sql}`,
    ...where.params,
  );

  return Number(rows[0]?.count ?? 0);
}

/* ── getOrganization ─────────────────────────────────────────────────────── */
export async function getOrganization(id: string, schemaName?: string, db: RawExecutor = prisma): Promise<OrganizationSummary> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => getOrganization(id, undefined, tx));
  }

  const rows = await db.$queryRawUnsafe<OrgRow[]>(
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

export async function registerOrganizationPiiAccess(
  organizationId: string,
  actorUserId: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<void> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) =>
      registerOrganizationPiiAccess(organizationId, actorUserId, undefined, tx));
  }

  await getOrganization(organizationId, undefined, db);
  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'organization.pii.accessed', 'organization', $2::uuid, $3::jsonb)`,
    actorUserId,
    organizationId,
    JSON.stringify({
      user_id: actorUserId,
      organization_id: organizationId,
      timestamp: new Date().toISOString(),
    }),
  );
}

export async function registerOrganizationPiiReveal(
  organizationId: string,
  actorUserId: string,
  schemaName?: string,
  db: RawExecutor = prisma,
  meta?: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<void> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) =>
      registerOrganizationPiiReveal(organizationId, actorUserId, undefined, tx, meta));
  }

  await getOrganization(organizationId, undefined, db);
  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'organization.pii.revealed', 'organization', $2::uuid, $3::jsonb)`,
    actorUserId,
    organizationId,
    JSON.stringify({
      user_id: actorUserId,
      organization_id: organizationId,
      ip: meta?.ip ?? null,
      user_agent: meta?.userAgent ?? null,
      timestamp: new Date().toISOString(),
    }),
  );
}

/* ── getOrganizationStats ────────────────────────────────────────────────── */
export async function getOrganizationStats(id: string, schemaName?: string, db: RawExecutor = prisma): Promise<OrganizationStatsResult> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => getOrganizationStats(id, undefined, tx));
  }

  await getOrganization(id, undefined, db);

  const [stats] = await db.$queryRawUnsafe<OrgStatsRow[]>(
    `SELECT
       COUNT(DISTINCT c.id)                                                   AS total_contacts,
       COUNT(DISTINCT conv.id)                                                AS total_conversations,
       COUNT(DISTINCT conv.id) FILTER (WHERE conv.status = 'open') AS open_conversations,
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
export async function getOrganizationContacts(id: string, schemaName?: string, db: RawExecutor = prisma): Promise<OrganizationContactListItem[]> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => getOrganizationContacts(id, undefined, tx));
  }

  await getOrganization(id, undefined, db);
  return db.$queryRawUnsafe<OrganizationContactListItem[]>(
    `SELECT id, name, email, phone, whatsapp, role, is_primary, created_at
     FROM contacts WHERE organization_id = $1::uuid ORDER BY is_primary DESC, name ASC`,
    id,
  );
}

/* ── getOrganizationConversations ────────────────────────────────────────── */
export async function getOrganizationConversations(id: string, schemaName?: string, db: RawExecutor = prisma): Promise<Array<{
  id: string;
  status: string;
  channel_type: string | null;
  protocol: string | null;
  subject: string | null;
  bot_department: string | null;
  last_message: string | null;
  last_message_at: Date | null;
  created_at: Date;
}>> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => getOrganizationConversations(id, undefined, tx));
  }

  await getOrganization(id, undefined, db);
  return db.$queryRawUnsafe<Array<{
    id: string;
    status: string;
    channel_type: string | null;
    protocol: string | null;
    subject: string | null;
    bot_department: string | null;
    last_message: string | null;
    last_message_at: Date | null;
    created_at: Date;
  }>>(
    `SELECT
       cv.id,
       cv.status,
       cv.channel_type,
       cv.protocol_number AS protocol,
       cv.subject,
       cv.metadata->>'bot_department' AS bot_department,
       cv.last_message,
       cv.last_message_at,
       cv.created_at
     FROM conversations cv
     WHERE cv.organization_id = $1::uuid
     ORDER BY cv.created_at DESC
     LIMIT 20`,
    id,
  );
}

/* ── getOrganizationTickets ──────────────────────────────────────────────── */
export async function getOrganizationTickets(id: string, schemaName?: string, db: RawExecutor = prisma): Promise<Array<{ id: string; title: string; status: string; priority: string; created_at: Date }>> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => getOrganizationTickets(id, undefined, tx));
  }

  await getOrganization(id, undefined, db);
  return db.$queryRawUnsafe<Array<{ id: string; title: string; status: string; priority: string; created_at: Date }>>(
    `SELECT id, title, status, priority, created_at
     FROM tickets WHERE organization_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
    id,
  );
}

/* ── createOrganization ──────────────────────────────────────────────────── */
export async function createOrganization(
  data: CreateOrganizationInput,
  createdBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<OrgRow> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => createOrganization(data, createdBy, undefined, tx));
  }

  const normalizedEmail = normalizeEmailForComparison(data.email ?? null);
  const normalizedDocument = normalizeDocumentForComparison(data.document ?? null);
  await assertUniqueOrganizationEmail(normalizedEmail, undefined, db);
  await assertUniqueOrganizationDocument(normalizedDocument, undefined, db);

  const tagsLiteral    = toPgArray(data.tags ?? []);
  const customFieldsJson = JSON.stringify(data.custom_fields ?? {});

  const rows = await db.$queryRawUnsafe<OrgRow[]>(
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

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'organization.created', 'organization', $2::uuid, $3::jsonb)`,
    createdBy, org.id, JSON.stringify(org),
  );

  return org;
}

/* ── updateOrganization ──────────────────────────────────────────────────── */
export async function updateOrganization(
  id: string,
  data: UpdateOrganizationInput,
  updatedBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<OrgRow> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => updateOrganization(id, data, updatedBy, undefined, tx));
  }

  const existing = await getOrganization(id, undefined, db);
  const normalizedEmail = data.email === undefined ? undefined : normalizeEmailForComparison(data.email);
  const normalizedDocument = data.document === undefined ? undefined : normalizeDocumentForComparison(data.document);

  if (normalizedEmail !== undefined) {
    await assertUniqueOrganizationEmail(normalizedEmail, id, db);
  }
  if (normalizedDocument !== undefined) {
    await assertUniqueOrganizationDocument(normalizedDocument, id, db);
  }

  const tagsLiteral = data.tags === undefined ? undefined : toPgArray(data.tags ?? []);
  const customFieldsJson = data.custom_fields === undefined ? undefined : JSON.stringify(data.custom_fields);

  const hasType = Object.prototype.hasOwnProperty.call(data, 'type');
  const hasName = Object.prototype.hasOwnProperty.call(data, 'name');
  const hasDocument = Object.prototype.hasOwnProperty.call(data, 'document');
  const hasEmail = Object.prototype.hasOwnProperty.call(data, 'email');
  const hasPhone = Object.prototype.hasOwnProperty.call(data, 'phone');
  const hasWebsite = Object.prototype.hasOwnProperty.call(data, 'website');
  const hasStatus = Object.prototype.hasOwnProperty.call(data, 'status');
  const hasAddressStreet = Object.prototype.hasOwnProperty.call(data, 'address_street');
  const hasAddressCity = Object.prototype.hasOwnProperty.call(data, 'address_city');
  const hasAddressState = Object.prototype.hasOwnProperty.call(data, 'address_state');
  const hasAddressZip = Object.prototype.hasOwnProperty.call(data, 'address_zip');
  const hasSegment = Object.prototype.hasOwnProperty.call(data, 'segment');
  const hasLeadSource = Object.prototype.hasOwnProperty.call(data, 'lead_source');
  const hasResponsibleId = Object.prototype.hasOwnProperty.call(data, 'responsible_id');
  const hasTags = Object.prototype.hasOwnProperty.call(data, 'tags');
  const hasCustomFields = Object.prototype.hasOwnProperty.call(data, 'custom_fields');
  const hasNotes = Object.prototype.hasOwnProperty.call(data, 'notes');

  const rows = await db.$queryRawUnsafe<OrgRow[]>(
    `UPDATE organizations SET
       type            = CASE WHEN $1::boolean THEN $2 ELSE type END,
       name            = CASE WHEN $3::boolean THEN $4 ELSE name END,
       document        = CASE WHEN $5::boolean THEN $6 ELSE document END,
       email           = CASE WHEN $7::boolean THEN $8 ELSE email END,
       phone           = CASE WHEN $9::boolean THEN $10 ELSE phone END,
       website         = CASE WHEN $11::boolean THEN $12 ELSE website END,
       status          = CASE WHEN $13::boolean THEN $14 ELSE status END,
       address_street  = CASE WHEN $15::boolean THEN $16 ELSE address_street END,
       address_city    = CASE WHEN $17::boolean THEN $18 ELSE address_city END,
       address_state   = CASE WHEN $19::boolean THEN $20 ELSE address_state END,
       address_zip     = CASE WHEN $21::boolean THEN $22 ELSE address_zip END,
       segment         = CASE WHEN $23::boolean THEN $24 ELSE segment END,
       lead_source     = CASE WHEN $25::boolean THEN $26 ELSE lead_source END,
       responsible_id  = CASE WHEN $27::boolean THEN $28::uuid ELSE responsible_id END,
       tags            = CASE WHEN $29::boolean THEN $30::text[] ELSE tags END,
       custom_fields   = CASE WHEN $31::boolean THEN $32::jsonb ELSE custom_fields END,
       notes           = CASE WHEN $33::boolean THEN $34 ELSE notes END,
       updated_at      = NOW()
     WHERE id = $35::uuid
     RETURNING *`,
    hasType, data.type ?? null,
    hasName, data.name ?? null,
    hasDocument, normalizedDocument ?? null,
    hasEmail, normalizedEmail ?? null,
    hasPhone, data.phone ?? null,
    hasWebsite, data.website ?? null,
    hasStatus, data.status ?? null,
    hasAddressStreet, data.address_street ?? null,
    hasAddressCity, data.address_city ?? null,
    hasAddressState, data.address_state ?? null,
    hasAddressZip, data.address_zip ?? null,
    hasSegment, data.segment ?? null,
    hasLeadSource, data.lead_source ?? null,
    hasResponsibleId, data.responsible_id ?? null,
    hasTags, tagsLiteral ?? null,
    hasCustomFields, customFieldsJson ?? null,
    hasNotes, data.notes ?? null,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Organização');
  const updated = rows[0];

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'organization.updated', 'organization', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy, id, JSON.stringify(existing), JSON.stringify(updated),
  );

  return updated;
}

/* ── deleteOrganization ──────────────────────────────────────────────────── */
export async function deleteOrganization(
  id: string,
  deletedBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<OrganizationSummary> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => deleteOrganization(id, deletedBy, undefined, tx));
  }

  const existing = await getOrganization(id, undefined, db);

  await db.$executeRawUnsafe(
    `UPDATE contacts SET organization_id = NULL, updated_at = NOW() WHERE organization_id = $1::uuid`,
    id,
  );
  await db.$executeRawUnsafe(
    `UPDATE conversations SET organization_id = NULL WHERE organization_id = $1::uuid`,
    id,
  );
  await db.$executeRawUnsafe(
    `UPDATE tickets SET organization_id = NULL WHERE organization_id = $1::uuid`,
    id,
  );
  await db.$executeRawUnsafe(
    `DELETE FROM organizations WHERE id = $1::uuid`,
    id,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data)
     VALUES ($1::uuid, 'organization.deleted', 'organization', $2::uuid, $3::jsonb)`,
    deletedBy, id, JSON.stringify(existing),
  );

  return existing;
}

export interface BulkDeleteOrganizationsResult {
  requested: number;
  deleted: string[];
  blocked: Array<{ id: string; reason: string }>;
  not_found: string[];
}

export async function bulkDeleteOrganizations(
  data: BulkDeleteOrganizationsInput,
  deletedBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<BulkDeleteOrganizationsResult> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => bulkDeleteOrganizations(data, deletedBy, undefined, tx));
  }

  let uniqueIds: string[];
  if (data.ids) {
    uniqueIds = [...new Set(data.ids)];
  } else {
    const where = buildOrganizationFilterWhere({
      filter: data.filter ?? {},
      excludeIds: data.exclude_ids,
    });
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT o.id::text
       FROM organizations o
       WHERE ${where.sql}
       ORDER BY o.id`,
      ...where.params,
    );
    uniqueIds = rows.map((row) => row.id);
  }

  const result: BulkDeleteOrganizationsResult = {
    requested: uniqueIds.length,
    deleted: [],
    blocked: [],
    not_found: [],
  };

  for (const id of uniqueIds) {
    try {
      await deleteOrganization(id, deletedBy, undefined, db);
      result.deleted.push(id);
    } catch (error) {
      if (error instanceof ConflictError) {
        result.blocked.push({ id, reason: error.message });
        continue;
      }
      if (error instanceof NotFoundError) {
        result.not_found.push(id);
        continue;
      }
      throw error;
    }
  }

  if (data.filter) {
    await db.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, new_data)
       VALUES ($1::uuid, 'bulk_delete_by_filter', 'organizations', $2::jsonb)`,
      deletedBy,
      JSON.stringify({
        filter: data.filter,
        exclude_ids: data.exclude_ids ?? [],
        affected_count: result.deleted.length,
        blocked_count: result.blocked.length,
      }),
    );
  }

  return result;
}
