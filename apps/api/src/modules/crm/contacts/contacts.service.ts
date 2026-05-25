import { prisma } from '../../../config/database.js';
import { type RawExecutor, withOptionalSchema } from '../crm.db.js';
import type {
  CreateContactInput,
  UpdateContactInput,
  ListContactsQuery,
  UpdateContactLgpdConsentInput,
  AnonymizeContactLgpdInput,
  ListLgpdRequestsQuery,
} from './contacts.schema.js';
import bcrypt from 'bcryptjs';
import { normalizePhoneForStorage, PhoneNormalizationError } from '../../../utils/phone.js';
import { dispatchWebhook } from '../../../services/webhook-dispatcher.js';

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

export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanLimitError';
  }
}

interface ContactRow {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  organization_status: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  document: string | null;
  role: string | null;
  department: string | null;
  is_primary: boolean;
  avatar_url: string | null;
  portal_enabled: boolean;
  portal_last_login: Date | null;
  portal_invited_at: Date | null;
  lgpd_consent_status: string;
  lgpd_consent_at: Date | null;
  lgpd_consent_source: string | null;
  lgpd_last_export_at: Date | null;
  lgpd_anonymized_at: Date | null;
  lgpd_anonymization_reason: string | null;
  tags: string[];
  custom_fields: unknown;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface LgpdRequestRow {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  request_type: string;
  status: string;
  requested_by: string | null;
  requested_by_name: string | null;
  processed_by: string | null;
  processed_by_name: string | null;
  payload: unknown;
  result: unknown;
  requested_at: Date;
  processed_at: Date | null;
}

interface ContactStatsRow {
  contact_exists: boolean;
  total_conversations: bigint;
  total_messages: bigint;
  open_tickets: bigint;
}

interface ContactConflictRow {
  id: string;
  name: string;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
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

async function assertUniqueContactPhone(
  phone: string | null,
  ignoreContactId?: string,
  db: RawExecutor = prisma,
): Promise<void> {
  if (!phone) return;

  const digits = phone.replace(/\D/g, '');
  const rows = await db.$queryRawUnsafe<ContactConflictRow[]>(
    `SELECT id, name
     FROM contacts
     WHERE ($1::uuid IS NULL OR id != $1::uuid)
       AND (
         phone = $2
         OR whatsapp = $2
         OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $3
         OR regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $3
       )
     ORDER BY created_at ASC
     LIMIT 1`,
    ignoreContactId ?? null,
    phone,
    digits,
  );

  if (rows[0]) {
    throw new ConflictError(`Já existe um contato com este telefone (${rows[0].name}).`);
  }
}

async function assertUniqueContactDocument(
  document: string | null,
  ignoreContactId?: string,
  db: RawExecutor = prisma,
): Promise<void> {
  if (!document) return;

  const rows = await db.$queryRawUnsafe<ContactConflictRow[]>(
    `SELECT id, name
     FROM contacts
     WHERE ($1::uuid IS NULL OR id != $1::uuid)
       AND regexp_replace(COALESCE(document, ''), '\\D', '', 'g') = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    ignoreContactId ?? null,
    document,
  );

  if (rows[0]) {
    throw new ConflictError(`Já existe um contato com este CPF/CNPJ (${rows[0].name}).`);
  }
}

async function assertUniqueContactEmail(
  email: string | null,
  ignoreContactId?: string,
  db: RawExecutor = prisma,
): Promise<void> {
  if (!email) return;

  const rows = await db.$queryRawUnsafe<ContactConflictRow[]>(
    `SELECT id, name
     FROM contacts
     WHERE ($1::uuid IS NULL OR id != $1::uuid)
       AND lower(trim(COALESCE(email, ''))) = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    ignoreContactId ?? null,
    email,
  );

  if (rows[0]) {
    throw new ConflictError(`Já existe um contato com este e-mail (${rows[0].name}).`);
  }
}

async function assertContactPlanLimit(tenantId?: string, db: RawExecutor = prisma): Promise<void> {
  if (!tenantId) return;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { plan: { select: { maxContacts: true } } },
  });
  if (!tenant) throw new NotFoundError('Tenant');

  const maxContacts = tenant.plan.maxContacts;
  if (maxContacts < 0) return;

  const countRows = await db.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count FROM contacts`,
  );
  const currentContacts = Number(countRows[0]?.count ?? 0);

  if (currentContacts >= maxContacts) {
    throw new PlanLimitError(`Limite de ${maxContacts} contatos atingido para o seu plano`);
  }
}

const BASE_SELECT = `
  SELECT
    ct.id, ct.organization_id, ct.name, ct.email, ct.phone, ct.whatsapp,
    ct.document, ct.role, ct.department, ct.is_primary, ct.avatar_url,
    ct.portal_enabled, ct.portal_last_login, ct.portal_invited_at,
    ct.lgpd_consent_status, ct.lgpd_consent_at, ct.lgpd_consent_source,
    ct.lgpd_last_export_at, ct.lgpd_anonymized_at, ct.lgpd_anonymization_reason,
    ct.tags, ct.custom_fields, ct.notes, ct.created_at, ct.updated_at,
    o.name   AS organization_name,
    o.status AS organization_status
  FROM contacts ct
  LEFT JOIN organizations o ON o.id = ct.organization_id`;

/* ── listContacts ────────────────────────────────────────────────────────── */
export async function listContacts(
  query: ListContactsQuery,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => listContacts(query, undefined, tx));
  }

  const { page, per_page, organization_id, search, standalone_only } = query;
  const offset = (page - 1) * per_page;

  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `${BASE_SELECT}
     WHERE ($1::uuid IS NULL OR ct.organization_id = $1::uuid)
       AND ($2::text IS NULL OR ct.name ILIKE '%' || $2 || '%'
                             OR ct.email ILIKE '%' || $2 || '%'
                             OR ct.phone ILIKE '%' || $2 || '%'
                             OR ct.whatsapp ILIKE '%' || $2 || '%')
       AND ($3::boolean = false OR ct.organization_id IS NULL)
     ORDER BY ct.is_primary DESC, ct.name ASC
     LIMIT $4 OFFSET $5`,
    organization_id ?? null, search ?? null, standalone_only, per_page, offset,
  );

  const countRows = await db.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count FROM contacts ct
     WHERE ($1::uuid IS NULL OR ct.organization_id = $1::uuid)
       AND ($2::text IS NULL OR ct.name ILIKE '%' || $2 || '%'
                             OR ct.email ILIKE '%' || $2 || '%'
                             OR ct.phone ILIKE '%' || $2 || '%'
                             OR ct.whatsapp ILIKE '%' || $2 || '%')
       AND ($3::boolean = false OR ct.organization_id IS NULL)`,
    organization_id ?? null, search ?? null, standalone_only,
  );

  const total = Number(countRows[0]?.count ?? 0);
  return {
    data: rows,
    meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
  };
}

/* ── getContact ──────────────────────────────────────────────────────────── */
export async function getContact(id: string, schemaName?: string, db: RawExecutor = prisma) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => getContact(id, undefined, tx));
  }

  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `${BASE_SELECT} WHERE ct.id = $1::uuid LIMIT 1`, id,
  );
  if (!rows[0]) throw new NotFoundError('Contato');
  return rows[0];
}

/* ── getContactStats ─────────────────────────────────────────────────────── */
export async function getContactStats(id: string, schemaName: string) {
  const schema = quoteIdent(schemaName);
  const contactsRef = `${schema}.contacts`;
  const conversationsRef = `${schema}.conversations`;
  const messagesRef = `${schema}.messages`;
  const ticketsRef = `${schema}.tickets`;

  const [stats] = await prisma.$queryRawUnsafe<ContactStatsRow[]>(
    `WITH contact_row AS (
       SELECT id FROM ${contactsRef} WHERE id = $1::uuid
     ),
     conv_stats AS (
       SELECT COUNT(*) AS total_conversations
       FROM ${conversationsRef}
       WHERE contact_id = $1::uuid
     ),
     msg_stats AS (
       SELECT COUNT(m.*) AS total_messages
       FROM ${messagesRef} m
       JOIN ${conversationsRef} c ON c.id = m.conversation_id
       WHERE c.contact_id = $1::uuid
     ),
     ticket_stats AS (
       SELECT COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) AS open_tickets
       FROM ${ticketsRef}
       WHERE contact_id = $1::uuid
     )
     SELECT
       EXISTS(SELECT 1 FROM contact_row) AS contact_exists,
       conv_stats.total_conversations,
       msg_stats.total_messages,
       ticket_stats.open_tickets
     FROM conv_stats, msg_stats, ticket_stats`,
    id,
  );

  if (!stats?.contact_exists) throw new NotFoundError('Contato');

  return {
    total_conversations: Number(stats.total_conversations ?? 0),
    total_messages: Number(stats.total_messages ?? 0),
    open_tickets: Number(stats.open_tickets ?? 0),
  };
}

/* ── findByWhatsapp ──────────────────────────────────────────────────────── */
export async function findByWhatsapp(number: string) {
  const normalized = normalizePhoneForStorage(number);
  const digits = number.replace(/\D/g, '');

  const rows = await prisma.$queryRawUnsafe<ContactRow[]>(
    `${BASE_SELECT}
     WHERE ct.whatsapp = $1
        OR ct.phone = $1
        OR regexp_replace(COALESCE(ct.whatsapp, ''), '\\D', '', 'g') = $2
        OR regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') = $2
     LIMIT 1`,
    normalized ?? number,
    digits,
  );
  return rows[0] ?? null;
}

/* ── createContact ───────────────────────────────────────────────────────── */
export async function createContact(
  data: CreateContactInput,
  createdBy: string,
  tenantId?: string,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => createContact(data, createdBy, tenantId, undefined, tx));
  }

  let normalizedPhone: string | null = null;
  let normalizedWhatsapp: string | null = null;
  const normalizedDocument = normalizeDocumentForComparison(data.document ?? null);
  const normalizedEmail = normalizeEmailForComparison(data.email ?? null);

  try {
    normalizedPhone = normalizePhoneForStorage(data.phone ?? null);
    normalizedWhatsapp = normalizePhoneForStorage(data.whatsapp ?? data.phone ?? null);
  } catch (err) {
    if (err instanceof PhoneNormalizationError) {
      throw new ConflictError(err.message);
    }
    throw err;
  }

  if (data.is_primary && data.organization_id) {
    await db.$executeRawUnsafe(
      `UPDATE contacts SET is_primary = false WHERE organization_id = $1::uuid AND is_primary = true`,
      data.organization_id,
    );
  }

  const tagsLiteral    = toPgArray(data.tags ?? []);
  const customFieldsJson = JSON.stringify(data.custom_fields ?? {});

  await assertUniqueContactPhone(normalizedPhone, undefined, db);
  if (normalizedWhatsapp !== normalizedPhone) {
    await assertUniqueContactPhone(normalizedWhatsapp, undefined, db);
  }
  await assertUniqueContactDocument(normalizedDocument, undefined, db);
  await assertUniqueContactEmail(normalizedEmail, undefined, db);
  await assertContactPlanLimit(tenantId, db);

  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `INSERT INTO contacts (
       organization_id, name, email, phone, whatsapp, document,
       role, department, is_primary, tags, custom_fields, notes
    ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11::jsonb, $12)
     RETURNING *`,
    data.organization_id ?? null, data.name, normalizedEmail, normalizedPhone,
    normalizedWhatsapp, normalizedDocument, data.role ?? null, data.department ?? null,
    data.is_primary ?? false, tagsLiteral, customFieldsJson, data.notes ?? null,
  );

  const contact = rows[0]!;

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'contact.created', 'contact', $2::uuid, $3::jsonb)`,
    createdBy, contact.id, JSON.stringify(contact),
  );

  if (tenantId) {
    void dispatchWebhook(tenantId, 'contact.created', {
      contact: { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone },
    });
  }

  return contact;
}

/* ── updateContact ───────────────────────────────────────────────────────── */
export async function updateContact(
  id: string,
  data: UpdateContactInput,
  updatedBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => updateContact(id, data, updatedBy, undefined, tx));
  }

  const existing = await getContact(id, undefined, db);
  const normalizedDocument = data.document === undefined
    ? undefined
    : normalizeDocumentForComparison(data.document);
  const normalizedEmail = data.email === undefined
    ? undefined
    : normalizeEmailForComparison(data.email);

  let normalizedPhone: string | null | undefined = undefined;
  let normalizedWhatsapp: string | null | undefined = undefined;
  try {
    if (data.phone !== undefined) {
      normalizedPhone = normalizePhoneForStorage(data.phone ?? null);
    }
    if (data.whatsapp !== undefined) {
      normalizedWhatsapp = normalizePhoneForStorage(data.whatsapp ?? null);
    }
  } catch (err) {
    if (err instanceof PhoneNormalizationError) {
      throw new ConflictError(err.message);
    }
    throw err;
  }

  if (data.is_primary === true) {
    const orgId = data.organization_id ?? existing.organization_id;
    if (orgId) {
      await db.$executeRawUnsafe(
        `UPDATE contacts SET is_primary = false WHERE organization_id = $1::uuid AND id != $2::uuid AND is_primary = true`,
        orgId, id,
      );
    }
  }

  const tagsLiteral = data.tags === undefined ? undefined : toPgArray(data.tags ?? []);
  const customFieldsJson = data.custom_fields === undefined
    ? undefined
    : JSON.stringify(data.custom_fields);

  if (normalizedPhone !== undefined) {
    await assertUniqueContactPhone(normalizedPhone, id, db);
  }
  if (normalizedWhatsapp !== undefined && normalizedWhatsapp !== normalizedPhone) {
    await assertUniqueContactPhone(normalizedWhatsapp, id, db);
  }
  if (normalizedDocument !== undefined) {
    await assertUniqueContactDocument(normalizedDocument, id, db);
  }
  if (normalizedEmail !== undefined) {
    await assertUniqueContactEmail(normalizedEmail, id, db);
  }

  const hasOrganizationId = Object.prototype.hasOwnProperty.call(data, 'organization_id');
  const hasName = Object.prototype.hasOwnProperty.call(data, 'name');
  const hasEmail = Object.prototype.hasOwnProperty.call(data, 'email');
  const hasPhone = Object.prototype.hasOwnProperty.call(data, 'phone');
  const hasWhatsapp = Object.prototype.hasOwnProperty.call(data, 'whatsapp');
  const hasDocument = Object.prototype.hasOwnProperty.call(data, 'document');
  const hasRole = Object.prototype.hasOwnProperty.call(data, 'role');
  const hasDepartment = Object.prototype.hasOwnProperty.call(data, 'department');
  const hasIsPrimary = Object.prototype.hasOwnProperty.call(data, 'is_primary') && data.is_primary !== null;
  const hasTags = Object.prototype.hasOwnProperty.call(data, 'tags');
  const hasCustomFields = Object.prototype.hasOwnProperty.call(data, 'custom_fields');
  const hasNotes = Object.prototype.hasOwnProperty.call(data, 'notes');

  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `UPDATE contacts SET
       organization_id = CASE WHEN $1::boolean THEN $2::uuid ELSE organization_id END,
       name            = CASE WHEN $3::boolean THEN $4 ELSE name END,
       email           = CASE WHEN $5::boolean THEN $6 ELSE email END,
       phone           = CASE WHEN $7::boolean THEN $8 ELSE phone END,
       whatsapp        = CASE WHEN $9::boolean THEN $10 ELSE whatsapp END,
       document        = CASE WHEN $11::boolean THEN $12 ELSE document END,
       role            = CASE WHEN $13::boolean THEN $14 ELSE role END,
       department      = CASE WHEN $15::boolean THEN $16 ELSE department END,
       is_primary      = CASE WHEN $17::boolean THEN $18::boolean ELSE is_primary END,
       tags            = CASE WHEN $19::boolean THEN $20::text[] ELSE tags END,
       custom_fields   = CASE WHEN $21::boolean THEN $22::jsonb ELSE custom_fields END,
       notes           = CASE WHEN $23::boolean THEN $24 ELSE notes END,
       updated_at      = NOW()
     WHERE id = $25::uuid
     RETURNING *`,
    hasOrganizationId, data.organization_id ?? null,
    hasName, data.name ?? null,
    hasEmail, normalizedEmail ?? null,
    hasPhone, normalizedPhone ?? null,
    hasWhatsapp, normalizedWhatsapp ?? null,
    hasDocument, normalizedDocument ?? null,
    hasRole, data.role ?? null,
    hasDepartment, data.department ?? null,
    hasIsPrimary, data.is_primary ?? null,
    hasTags, tagsLiteral ?? null,
    hasCustomFields, customFieldsJson ?? null,
    hasNotes, data.notes ?? null,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Contato');
  const updated = rows[0];

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'contact.updated', 'contact', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy, id, JSON.stringify(existing), JSON.stringify(updated),
  );

  return updated;
}

/* ── deleteContact ───────────────────────────────────────────────────────── */
export async function deleteContact(
  id: string,
  deletedBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => deleteContact(id, deletedBy, undefined, tx));
  }

  const existing = await getContact(id, undefined, db);

  const linked = await db.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM conversations
     WHERE contact_id = $1::uuid
       AND status = 'open'`,
    id,
  );

  if (Number(linked[0]?.count ?? 0) > 0) {
    throw new ConflictError('Contato possui conversas ativas. Encerre-as antes de excluir.');
  }

  await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id = $1::uuid`, id);

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data)
     VALUES ($1::uuid, 'contact.deleted', 'contact', $2::uuid, $3::jsonb)`,
    deletedBy, id, JSON.stringify(existing),
  );

  return existing;
}

/* ── linkToOrganization ──────────────────────────────────────────────────── */
export async function linkToOrganization(
  contactId: string,
  organizationId: string,
  updatedBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => linkToOrganization(contactId, organizationId, updatedBy, undefined, tx));
  }

  const existing = await getContact(contactId, undefined, db);

  await db.$executeRawUnsafe(
    `UPDATE contacts SET organization_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
    organizationId, contactId,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'contact.linked', 'contact', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy, contactId, JSON.stringify(existing), JSON.stringify({ organization_id: organizationId }),
  );

  return getContact(contactId, undefined, db);
}

interface LgpdConversationRow {
  id: string;
  channel_type: string;
  status: string;
  subject: string | null;
  last_message: string | null;
  created_at: Date;
  closed_at: Date | null;
}

interface LgpdMessageRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  content: string | null;
  content_type: string;
  media_url: string | null;
  status: string;
  is_internal: boolean;
  created_at: Date;
}

interface LgpdTicketRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: Date;
}

async function createLgpdRequestRecord(
  contactId: string,
  requestType: string,
  actorUserId: string | null,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
  db: RawExecutor = prisma,
): Promise<LgpdRequestRow> {
  const rows = await db.$queryRawUnsafe<LgpdRequestRow[]>(
    `INSERT INTO lgpd_requests (
      contact_id, request_type, status, requested_by, processed_by, payload, result, processed_at
    )
    VALUES ($1::uuid, $2, 'processed', $3::uuid, $3::uuid, $4::jsonb, $5::jsonb, NOW())
    RETURNING *`,
    contactId,
    requestType,
    actorUserId ?? null,
    JSON.stringify(payload),
    JSON.stringify(result),
  );

  return rows[0]!;
}

export async function listLgpdRequests(
  query: ListLgpdRequestsQuery,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => listLgpdRequests(query, undefined, tx));
  }

  const { page, per_page, contact_id, request_type, status } = query;
  const offset = (page - 1) * per_page;

  const data = await db.$queryRawUnsafe<LgpdRequestRow[]>(
    `SELECT
      lr.id,
      lr.contact_id,
      ct.name AS contact_name,
      lr.request_type,
      lr.status,
      lr.requested_by,
      ru.name AS requested_by_name,
      lr.processed_by,
      pu.name AS processed_by_name,
      lr.payload,
      lr.result,
      lr.requested_at,
      lr.processed_at
    FROM lgpd_requests lr
    LEFT JOIN contacts ct ON ct.id = lr.contact_id
    LEFT JOIN users ru ON ru.id = lr.requested_by
    LEFT JOIN users pu ON pu.id = lr.processed_by
    WHERE ($1::uuid IS NULL OR lr.contact_id = $1::uuid)
      AND ($2::text IS NULL OR lr.request_type = $2::text)
      AND ($3::text IS NULL OR lr.status = $3::text)
    ORDER BY lr.requested_at DESC
    LIMIT $4 OFFSET $5`,
    contact_id ?? null,
    request_type ?? null,
    status ?? null,
    per_page,
    offset,
  );

  const countRows = await db.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
    FROM lgpd_requests lr
    WHERE ($1::uuid IS NULL OR lr.contact_id = $1::uuid)
      AND ($2::text IS NULL OR lr.request_type = $2::text)
      AND ($3::text IS NULL OR lr.status = $3::text)`,
    contact_id ?? null,
    request_type ?? null,
    status ?? null,
  );

  const total = Number(countRows[0]?.count ?? 0);

  return {
    data,
    meta: {
      total,
      page,
      per_page,
      total_pages: Math.ceil(total / per_page),
    },
  };
}

export async function updateContactLgpdConsent(
  id: string,
  data: UpdateContactLgpdConsentInput,
  updatedBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => updateContactLgpdConsent(id, data, updatedBy, undefined, tx));
  }

  const previous = await getContact(id, undefined, db);

  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `UPDATE contacts SET
       lgpd_consent_status = $1,
       lgpd_consent_source = CASE WHEN $2::boolean THEN $3 ELSE lgpd_consent_source END,
       lgpd_consent_at = NOW(),
       updated_at = NOW()
     WHERE id = $4::uuid
     RETURNING *`,
    data.status,
    data.source !== undefined,
    data.source ?? null,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Contato');

  const updated = rows[0];
  const request = await createLgpdRequestRecord(
    id,
    'consent_update',
    updatedBy,
    { status: data.status, source: data.source ?? null },
    { consent_at: updated.lgpd_consent_at?.toISOString() ?? null },
    db,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'contact.lgpd.consent_updated', 'contact', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy,
    id,
    JSON.stringify({
      lgpd_consent_status: previous.lgpd_consent_status,
      lgpd_consent_source: previous.lgpd_consent_source,
      lgpd_consent_at: previous.lgpd_consent_at,
    }),
    JSON.stringify({
      lgpd_consent_status: updated.lgpd_consent_status,
      lgpd_consent_source: updated.lgpd_consent_source,
      lgpd_consent_at: updated.lgpd_consent_at,
      lgpd_request_id: request.id,
    }),
  );

  return { contact: updated, request };
}

export async function exportContactLgpdData(
  id: string,
  actorUserId: string,
  options: { includeMessages: boolean },
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => exportContactLgpdData(id, actorUserId, options, undefined, tx));
  }

  const contact = await getContact(id, undefined, db);

  const organizationRows = contact.organization_id
    ? await db.$queryRawUnsafe<Array<{ id: string; name: string; status: string; email: string | null; phone: string | null }>>(
      `SELECT id, name, status, email, phone
       FROM organizations
       WHERE id = $1::uuid
       LIMIT 1`,
      contact.organization_id,
    )
    : [];

  const conversations = await db.$queryRawUnsafe<LgpdConversationRow[]>(
    `SELECT id, channel_type, status, subject, last_message, created_at, closed_at
     FROM conversations
     WHERE contact_id = $1::uuid
     ORDER BY created_at DESC`,
    id,
  );

  const tickets = await db.$queryRawUnsafe<LgpdTicketRow[]>(
    `SELECT id, title, status, priority, created_at
     FROM tickets
     WHERE contact_id = $1::uuid
     ORDER BY created_at DESC`,
    id,
  );

  const messages = options.includeMessages
    ? await db.$queryRawUnsafe<LgpdMessageRow[]>(
      `SELECT m.id, m.conversation_id, m.sender_type, m.content, m.content_type, m.media_url, m.status, m.is_internal, m.created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.contact_id = $1::uuid
       ORDER BY m.created_at ASC`,
      id,
    )
    : [];

  const requests = await db.$queryRawUnsafe<LgpdRequestRow[]>(
    `SELECT id, contact_id, request_type, status, requested_by, processed_by, payload, result, requested_at, processed_at
     FROM lgpd_requests
     WHERE contact_id = $1::uuid
     ORDER BY requested_at DESC
     LIMIT 100`,
    id,
  );

  await db.$executeRawUnsafe(
    `UPDATE contacts
     SET lgpd_last_export_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid`,
    id,
  );

  const request = await createLgpdRequestRecord(
    id,
    'access',
    actorUserId,
    { include_messages: options.includeMessages },
    {
      conversations: conversations.length,
      tickets: tickets.length,
      messages: messages.length,
      requests: requests.length,
    },
    db,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'contact.lgpd.exported', 'contact', $2::uuid, $3::jsonb)`,
    actorUserId,
    id,
    JSON.stringify({
      include_messages: options.includeMessages,
      exported_at: new Date().toISOString(),
      lgpd_request_id: request.id,
    }),
  );

  return {
    generated_at: new Date().toISOString(),
    request_id: request.id,
    contact: {
      ...contact,
      lgpd_last_export_at: new Date().toISOString(),
    },
    organization: organizationRows[0] ?? null,
    conversations,
    tickets,
    messages,
    lgpd_requests: requests,
  };
}

export async function anonymizeContactForLgpd(
  id: string,
  actorUserId: string | null,
  input: AnonymizeContactLgpdInput,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => anonymizeContactForLgpd(id, actorUserId, input, undefined, tx));
  }

  const existing = await getContact(id, undefined, db);
  const anonymizedName = `Titular anonimizado ${id.slice(0, 8)}`;
  const reason = input.reason?.trim() || 'Solicitação LGPD';

  const redactedMessagesRows = input.redact_messages
    ? await db.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE messages m
       SET content = '[mensagem anonimizada por LGPD]',
           media_url = NULL,
           metadata = COALESCE(m.metadata, '{}'::jsonb) || '{"lgpd_redacted": true}'::jsonb
       FROM conversations c
       WHERE c.id = m.conversation_id
         AND c.contact_id = $1::uuid
         AND m.sender_type = 'client'
       RETURNING m.id`,
      id,
    )
    : [];

  const updatedConversationsRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE conversations
     SET last_message = CASE WHEN last_message IS NULL THEN NULL ELSE '[mensagem anonimizada por LGPD]' END
     WHERE contact_id = $1::uuid
     RETURNING id`,
    id,
  );

  await db.$executeRawUnsafe(
    `UPDATE call_records cr
     SET to_phone = NULL,
         from_phone = NULL
     FROM conversations c
     WHERE c.id = cr.conversation_id
       AND c.contact_id = $1::uuid`,
    id,
  );

  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `UPDATE contacts SET
       organization_id = NULL,
       name = $1,
       email = NULL,
       phone = NULL,
       whatsapp = NULL,
       document = NULL,
       role = NULL,
       department = NULL,
       avatar_url = NULL,
       portal_enabled = false,
       portal_password_hash = NULL,
       portal_last_login = NULL,
       portal_invited_at = NULL,
       lgpd_consent_status = 'revoked',
       lgpd_consent_source = 'lgpd_anonymization',
       lgpd_consent_at = NOW(),
       lgpd_anonymized_at = NOW(),
       lgpd_anonymization_reason = $2,
       tags = '{}'::text[],
       custom_fields = '{}'::jsonb,
       notes = NULL,
       updated_at = NOW()
     WHERE id = $3::uuid
     RETURNING *`,
    anonymizedName,
    reason,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Contato');

  const updated = rows[0];

  const request = await createLgpdRequestRecord(
    id,
    'anonymization',
    actorUserId,
    { reason, redact_messages: input.redact_messages },
    {
      conversations_updated: updatedConversationsRows.length,
      messages_redacted: redactedMessagesRows.length,
      anonymized_at: updated.lgpd_anonymized_at?.toISOString() ?? null,
    },
    db,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'contact.lgpd.anonymized', 'contact', $2::uuid, $3::jsonb, $4::jsonb)`,
    actorUserId,
    id,
    JSON.stringify(existing),
    JSON.stringify({
      id: updated.id,
      name: updated.name,
      lgpd_anonymized_at: updated.lgpd_anonymized_at,
      lgpd_request_id: request.id,
    }),
  );

  return {
    contact: updated,
    request,
    summary: {
      conversations_updated: updatedConversationsRows.length,
      messages_redacted: redactedMessagesRows.length,
    },
  };
}

function generateTemporaryPassword(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return password;
}

export async function createPortalAccess(
  contactId: string,
  tenantId: string,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => createPortalAccess(contactId, tenantId, undefined, tx));
  }

  const rows = await db.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    email: string | null;
  }>>(
    `SELECT id, name, email
     FROM contacts
     WHERE id = $1::uuid
     LIMIT 1`,
    contactId,
  );

  const contact = rows[0];
  if (!contact) throw new NotFoundError('Contato');
  if (!contact.email) {
    throw new ConflictError('Contato precisa ter e-mail para acessar o portal');
  }

  const tempPassword = generateTemporaryPassword();
  const hash = await bcrypt.hash(tempPassword, 10);

  await db.$executeRawUnsafe(
    `UPDATE contacts
     SET portal_enabled = true,
         portal_password_hash = $1,
         portal_invited_at = NOW()
     WHERE id = $2::uuid`,
    hash,
    contactId,
  );

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });

  const portalUrl = process.env['NODE_ENV'] === 'production'
    ? `https://suporte.${tenant?.slug}.ziradesk.com.br`
    : 'http://localhost:5173/portal';

  return {
    contact,
    portalUrl,
    tempPassword,
  };
}

export async function revokePortalAccess(
  contactId: string,
  schemaName?: string,
  db: RawExecutor = prisma,
) {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => revokePortalAccess(contactId, undefined, tx));
  }

  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE contacts
     SET portal_enabled = false,
         portal_password_hash = NULL
     WHERE id = $1::uuid
     RETURNING id`,
    contactId,
  );

  if (!rows[0]) throw new NotFoundError('Contato');
  return { revoked: true };
}
