import { prisma } from '../../../config/database.js';
import { type RawExecutor, withOptionalSchema } from '../crm.db.js';
import { createLgpdRequestRecord, type LgpdInsertedRequest } from '../../../lib/lgpd/index.js';
import {
  LGPD_EXPORT_SCHEMA_VERSION,
  validateExportPayload,
} from '../../../lib/lgpd/validate-export.js';
import { notifySubjectRequestProcessed, notifySubjectRequestRejected } from '../../../lib/lgpd/sla.service.js';
import { logger } from '../../../config/logger.js';
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
import { maskDocument, maskEmail, maskPhone, maskPiiFields } from '../../../utils/pii-mask.js';

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
  contact_email: string | null;
  contact_phone: string | null;
  contact_document: string | null;
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

interface RectificationApprovalRequestRow {
  id: string;
  contact_id: string | null;
  subject_type: string;
  request_type: string;
  status: string;
  payload: unknown;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_document: string | null;
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

interface PaginationMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface ListContactsResult {
  data: ContactRow[];
  meta: PaginationMeta;
}

interface ListLgpdRequestsResult {
  data: LgpdRequestRow[];
  meta: PaginationMeta;
}

interface ContactStatsResult {
  total_conversations: number;
  total_messages: number;
  open_tickets: number;
}

interface UpdateLgpdConsentResult {
  contact: ContactRow;
  request: LgpdInsertedRequest;
}

interface AnonymizeLgpdResult {
  contact: ContactRow;
  request: LgpdInsertedRequest;
  summary: {
    conversations_updated: number;
    messages_redacted: number;
  };
}

interface PortalAccessContact {
  id: string;
  name: string;
  email: string | null;
}

interface CreatePortalAccessResult {
  contact: PortalAccessContact;
  portalUrl: string;
  tempPassword: string;
}

export function maskContactRecord(contact: ContactRow): ContactRow {
  return maskPiiFields(contact);
}

export function maskContactListRecords(contacts: ContactRow[]): ContactRow[] {
  return contacts.map(maskContactRecord);
}

export function maskLgpdRequestRecords(requests: LgpdRequestRow[]): LgpdRequestRow[] {
  return requests.map((request) => ({
    ...request,
    contact_email: maskEmail(request.contact_email),
    contact_phone: maskPhone(request.contact_phone),
    contact_document: maskDocument(request.contact_document),
  }));
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
): Promise<ListContactsResult> {
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
export async function getContact(id: string, schemaName?: string, db: RawExecutor = prisma): Promise<ContactRow> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => getContact(id, undefined, tx));
  }

  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `${BASE_SELECT} WHERE ct.id = $1::uuid LIMIT 1`, id,
  );
  if (!rows[0]) throw new NotFoundError('Contato');
  return rows[0];
}

export async function registerContactPiiAccess(
  contactId: string,
  actorUserId: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<void> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) =>
      registerContactPiiAccess(contactId, actorUserId, undefined, tx));
  }

  await getContact(contactId, undefined, db);
  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'contact.pii.accessed', 'contact', $2::uuid, $3::jsonb)`,
    actorUserId,
    contactId,
    JSON.stringify({
      user_id: actorUserId,
      contact_id: contactId,
      timestamp: new Date().toISOString(),
    }),
  );
}

export async function registerContactPiiReveal(
  contactId: string,
  actorUserId: string,
  schemaName?: string,
  db: RawExecutor = prisma,
  meta?: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<void> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) =>
      registerContactPiiReveal(contactId, actorUserId, undefined, tx, meta));
  }

  await getContact(contactId, undefined, db);
  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'contact.pii.revealed', 'contact', $2::uuid, $3::jsonb)`,
    actorUserId,
    contactId,
    JSON.stringify({
      user_id: actorUserId,
      contact_id: contactId,
      ip: meta?.ip ?? null,
      user_agent: meta?.userAgent ?? null,
      timestamp: new Date().toISOString(),
    }),
  );
}

/* ── getContactStats ─────────────────────────────────────────────────────── */
export async function getContactStats(id: string, schemaName: string): Promise<ContactStatsResult> {
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
export async function findByWhatsapp(number: string): Promise<ContactRow | null> {
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
): Promise<ContactRow> {
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
): Promise<ContactRow> {
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
): Promise<ContactRow> {
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
): Promise<ContactRow> {
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

interface LgpdAuditEventRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  user_id: string | null;
  created_at: Date;
  data: unknown;
}

function extractTenantPrivacyMetadata(settings: unknown): {
  dataController: string | null;
  dataProcessor: string | null;
} {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { dataController: null, dataProcessor: null };
  }

  const record = settings as Record<string, unknown>;
  const dataController =
    typeof record['data_controller'] === 'string' ? record['data_controller'] :
      typeof record['dataController'] === 'string' ? record['dataController'] : null;
  const dataProcessor =
    typeof record['data_processor'] === 'string' ? record['data_processor'] :
      typeof record['dataProcessor'] === 'string' ? record['dataProcessor'] : null;

  return { dataController, dataProcessor };
}


export async function listLgpdRequests(
  query: ListLgpdRequestsQuery,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<ListLgpdRequestsResult> {
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
      ct.email AS contact_email,
      ct.phone AS contact_phone,
      ct.document AS contact_document,
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
    WHERE lr.subject_type = 'contact'
      AND ($1::uuid IS NULL OR lr.contact_id = $1::uuid)
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
    WHERE lr.subject_type = 'contact'
      AND ($1::uuid IS NULL OR lr.contact_id = $1::uuid)
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

function extractRectificationChangesFromPayload(payload: unknown): Partial<UpdateContactInput> {
  if (!payload || typeof payload !== 'object') {
    throw new ConflictError('Payload da solicitação de retificação inválido');
  }

  const payloadObject = payload as Record<string, unknown>;
  const requestedChangesRaw = payloadObject['requested_changes'];
  const source = (
    requestedChangesRaw && typeof requestedChangesRaw === 'object'
      ? requestedChangesRaw
      : payloadObject
  ) as Record<string, unknown>;

  const changes: Partial<UpdateContactInput> = {};

  if (typeof source['name'] === 'string' && source['name'].trim().length > 0) {
    changes.name = source['name'].trim();
  }
  if (typeof source['email'] === 'string' && source['email'].trim().length > 0) {
    changes.email = source['email'].trim();
  }
  if (typeof source['phone'] === 'string' && source['phone'].trim().length > 0) {
    changes.phone = source['phone'].trim();
  }
  if (typeof source['document'] === 'string' && source['document'].trim().length > 0) {
    changes.document = source['document'].trim();
  }

  if (Object.keys(changes).length === 0) {
    throw new ConflictError('Solicitação não possui campos válidos para retificação');
  }

  return changes;
}

async function loadRectificationRequestForAction(
  requestId: string,
  db: RawExecutor,
): Promise<RectificationApprovalRequestRow> {
  const rows = await db.$queryRawUnsafe<RectificationApprovalRequestRow[]>(
    `SELECT
       lr.id,
       lr.contact_id,
       lr.subject_type,
       lr.request_type,
       lr.status,
       lr.payload,
       ct.name AS contact_name,
       ct.email AS contact_email,
       ct.phone AS contact_phone,
       ct.document AS contact_document
     FROM lgpd_requests lr
     LEFT JOIN contacts ct ON ct.id = lr.contact_id
     WHERE lr.id = $1::uuid
     LIMIT 1`,
    requestId,
  );

  const request = rows[0];
  if (!request) {
    throw new NotFoundError('Solicitação LGPD');
  }
  if (request.subject_type !== 'contact' || request.request_type !== 'rectification') {
    throw new ConflictError('Solicitação não é de retificação de contato');
  }
  if (request.status !== 'pending') {
    throw new ConflictError('Solicitação já foi processada');
  }
  if (!request.contact_id) {
    throw new ConflictError('Solicitação sem contato vinculado');
  }

  return request;
}


export async function approveLgpdRectificationRequest(
  requestId: string,
  actorUserId: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<{ id: string; status: string; contact: ContactRow }> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) =>
      approveLgpdRectificationRequest(requestId, actorUserId, undefined, tx));
  }

  const request = await loadRectificationRequestForAction(requestId, db);
  const requestedChanges = extractRectificationChangesFromPayload(request.payload);
  const updatePayload: UpdateContactInput = {
    ...requestedChanges,
  };

  const previousSnapshot = {
    name: request.contact_name,
    email: request.contact_email,
    phone: request.contact_phone,
    document: request.contact_document,
  };

  const updatedContact = await updateContact(
    request.contact_id!,
    updatePayload,
    actorUserId,
    undefined,
    db,
  );

  await db.$executeRawUnsafe(
    `UPDATE lgpd_requests
     SET status = 'processed',
         processed_by = $1::uuid,
         processed_at = NOW(),
         result = result || $2::jsonb
     WHERE id = $3::uuid`,
    actorUserId,
    JSON.stringify({
      action: 'approved',
      requested_changes: requestedChanges,
      previous_data: previousSnapshot,
      updated_data: {
        name: updatedContact.name,
        email: updatedContact.email,
        phone: updatedContact.phone,
        document: updatedContact.document,
      },
    }),
    requestId,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'contact.lgpd.rectification_approved', 'lgpd_request', $2::uuid, $3::jsonb, $4::jsonb)`,
    actorUserId,
    requestId,
    JSON.stringify(previousSnapshot),
    JSON.stringify({
      contact_id: updatedContact.id,
      requested_changes: requestedChanges,
      updated_data: {
        name: updatedContact.name,
        email: updatedContact.email,
        phone: updatedContact.phone,
        document: updatedContact.document,
      },
    }),
  );

  const tenantRows = await db.$queryRawUnsafe<Array<{ id: string; name: string; settings: unknown; schema_name: string }>>(
    `SELECT id, name, settings, schema_name FROM tenants WHERE schema_name = current_schema()`,
  );
  const tenant = tenantRows[0];
  if (tenant) {
    const subjectEmail = updatedContact.email ?? request.contact_email;
    await notifySubjectRequestProcessed({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        schema_name: tenant.schema_name,
        settings: tenant.settings,
      },
      schemaName: tenant.schema_name,
      requestId,
      requestType: request.request_type,
      processedAt: new Date(),
      subjectEmail,
      notes: 'Solicitação de retificação aprovada',
    }).catch(() => undefined);
  }

  return {
    id: requestId,
    status: 'processed',
    contact: updatedContact,
  };
}

export async function rejectLgpdRectificationRequest(
  requestId: string,
  actorUserId: string,
  reason: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<{ id: string; status: string }> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) =>
      rejectLgpdRectificationRequest(requestId, actorUserId, reason, undefined, tx));
  }

  const request = await loadRectificationRequestForAction(requestId, db);

  await db.$executeRawUnsafe(
    `UPDATE lgpd_requests
     SET status = 'rejected',
         processed_by = $1::uuid,
         processed_at = NOW(),
         result = result || $2::jsonb
     WHERE id = $3::uuid`,
    actorUserId,
    JSON.stringify({
      action: 'rejected',
      reason,
    }),
    requestId,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'contact.lgpd.rectification_rejected', 'lgpd_request', $2::uuid, $3::jsonb)`,
    actorUserId,
    requestId,
    JSON.stringify({
      reason,
      requested_payload: request.payload,
    }),
  );

  const subjectEmail = request.contact_email;
  if (subjectEmail) {
    const tenantRows = await db.$queryRawUnsafe<Array<{ id: string; name: string; schema_name: string; settings: unknown }>>(
      `SELECT id, name, schema_name, settings FROM tenants WHERE schema_name = current_schema()`,
    );
    const tenant = tenantRows[0];
    if (tenant) {
      await notifySubjectRequestRejected({
        tenant: { id: tenant.id, name: tenant.name, schema_name: tenant.schema_name, settings: tenant.settings },
        schemaName: tenant.schema_name,
        requestId,
        requestType: request.request_type,
        rejectedAt: new Date(),
        reason,
        subjectEmail,
      }).catch(() => undefined);
    }
  }

  return {
    id: requestId,
    status: 'rejected',
  };
}

export async function updateContactLgpdConsent(
  id: string,
  data: UpdateContactLgpdConsentInput,
  updatedBy: string,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<UpdateLgpdConsentResult> {
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
    {
      subjectType: 'contact',
      subjectId: id,
      requestType: 'consent_update',
      actorUserId: updatedBy,
      payload: { status: data.status, source: data.source ?? null },
      result: { consent_at: updated.lgpd_consent_at?.toISOString() ?? null },
    },
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
): Promise<Record<string, unknown>> {
  if (schemaName) {
    return withOptionalSchema(schemaName, (tx) => exportContactLgpdData(id, actorUserId, options, undefined, tx));
  }

  const contact = await getContact(id, undefined, db);
  const exportedAt = new Date();
  const exportedAtIso = exportedAt.toISOString();

  const actorRows = await db.$queryRawUnsafe<Array<{ id: string; name: string | null; email: string | null }>>(
    `SELECT id, name, email
     FROM users
     WHERE id = $1::uuid
     LIMIT 1`,
    actorUserId,
  ).catch(() => []);
  const actor = actorRows[0];

  const tenantRows = await db.$queryRawUnsafe<Array<{ id: string; name: string; settings: unknown }>>(
    `SELECT id, name, settings
     FROM public.tenants
     WHERE schema_name = current_schema()
     LIMIT 1`,
  ).catch(() => []);
  const tenant = tenantRows[0];
  const tenantPrivacy = extractTenantPrivacyMetadata(tenant?.settings);

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

  const auditEvents = await db.$queryRawUnsafe<LgpdAuditEventRow[]>(
    `SELECT id, action, entity, entity_id, user_id, created_at, COALESCE(new_data, old_data, '{}'::jsonb) AS data
     FROM audit_logs
     WHERE entity_id = $1::uuid
        OR (entity = 'contact' AND entity_id = $1::uuid)
     ORDER BY created_at DESC
     LIMIT 500`,
    id,
  );

  await db.$executeRawUnsafe(
    `UPDATE contacts
     SET lgpd_last_export_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid`,
    id,
  );

  const request = await createLgpdRequestRecord(
    {
      subjectType: 'contact',
      subjectId: id,
      requestType: 'access',
      actorUserId,
      payload: { include_messages: options.includeMessages },
      result: {
        conversations: conversations.length,
        tickets: tickets.length,
        messages: messages.length,
        requests: requests.length,
      },
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
      exported_at: exportedAtIso,
      lgpd_request_id: request.id,
    }),
  );

  const conversationMessages = new Map<string, Array<Record<string, unknown>>>();
  for (const message of messages) {
    const list = conversationMessages.get(message.conversation_id) ?? [];
    list.push({
      id: message.id,
      conversation_id: message.conversation_id,
      sender_type: message.sender_type,
      content: message.content,
      content_type: message.content_type,
      media_url: message.media_url,
      status: message.status,
      is_internal: message.is_internal,
      created_at: message.created_at.toISOString(),
    });
    conversationMessages.set(message.conversation_id, list);
  }

  const legacyAuditTrail = {
    requests: requests.map((lgpdRequest) => ({
      id: lgpdRequest.id,
      request_type: lgpdRequest.request_type,
      status: lgpdRequest.status,
      requested_at: lgpdRequest.requested_at.toISOString(),
      processed_at: lgpdRequest.processed_at?.toISOString() ?? null,
      requested_by: lgpdRequest.requested_by,
      processed_by: lgpdRequest.processed_by,
      payload: lgpdRequest.payload,
      result: lgpdRequest.result,
    })),
    events: auditEvents.map((event) => ({
      id: event.id,
      action: event.action,
      entity: event.entity,
      entity_id: event.entity_id,
      created_at: event.created_at.toISOString(),
      actor_user_id: event.user_id,
      data: event.data,
    })),
  };

  const payload = {
    schema_version: LGPD_EXPORT_SCHEMA_VERSION,
    generated_at: exportedAtIso,
    exported_at: exportedAtIso,
    request_id: request.id,
    exported_by: {
      user_id: actor?.id ?? actorUserId,
      name: actor?.name ?? null,
      email: actor?.email ?? null,
    },
    subject: {
      type: 'contact',
      subject_type: 'contact',
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      document: contact.document,
      created_at: contact.created_at.toISOString(),
      updated_at: contact.updated_at.toISOString(),
    },
    consent: {
      status: contact.lgpd_consent_status,
      consent_at: contact.lgpd_consent_at?.toISOString() ?? null,
      consent_source: contact.lgpd_consent_source,
      history: [{
        status: contact.lgpd_consent_status,
        consent_at: contact.lgpd_consent_at?.toISOString() ?? null,
        consent_source: contact.lgpd_consent_source,
      }],
      source: contact.lgpd_consent_source,
      updated_at: contact.lgpd_consent_at?.toISOString() ?? null,
      last_export_at: exportedAtIso,
      anonymized_at: contact.lgpd_anonymized_at?.toISOString() ?? null,
      anonymization_reason: contact.lgpd_anonymization_reason,
    },
    contacts: [{
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      whatsapp: contact.whatsapp,
      document: contact.document,
      organization_id: contact.organization_id,
      role: contact.role,
      department: contact.department,
      portal_enabled: contact.portal_enabled,
      tags: contact.tags,
      custom_fields: contact.custom_fields,
      notes: contact.notes,
      created_at: contact.created_at.toISOString(),
      updated_at: contact.updated_at.toISOString(),
    }],
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      channel_type: conversation.channel_type,
      status: conversation.status,
      subject: conversation.subject,
      last_message: conversation.last_message,
      created_at: conversation.created_at.toISOString(),
      closed_at: conversation.closed_at?.toISOString() ?? null,
      messages: options.includeMessages ? (conversationMessages.get(conversation.id) ?? []) : [],
    })),
    messages: messages.map((message) => ({
      id: message.id,
      conversation_id: message.conversation_id,
      sender_type: message.sender_type,
      content: message.content,
      content_type: message.content_type,
      media_url: message.media_url,
      status: message.status,
      is_internal: message.is_internal,
      created_at: message.created_at.toISOString(),
    })),
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      created_at: ticket.created_at.toISOString(),
    })),
    audit_trail: legacyAuditTrail,
    metadata: {
      tenant_id: tenant?.id ?? null,
      tenant_name: tenant?.name ?? null,
      data_controller: tenantPrivacy.dataController ?? tenant?.name ?? null,
      data_processor: tenantPrivacy.dataProcessor ?? 'ZiraDesk',
    },
  };

  const validation = validateExportPayload(payload);
  if (!validation.valid) {
    const message = `Payload de exportação LGPD inválido: ${validation.errors.join('; ')}`;
    if (process.env.NODE_ENV === 'production') {
      logger.warn({ contactId: id, validationErrors: validation.errors }, '[LGPD] Export payload inválido para contato');
    } else {
      throw new Error(message);
    }
  }
  return payload;
}

export async function anonymizeContactForLgpd(
  id: string,
  actorUserId: string | null,
  input: AnonymizeContactLgpdInput,
  schemaName?: string,
  db: RawExecutor = prisma,
): Promise<AnonymizeLgpdResult> {
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
       RETURNING m.id`,
      id,
    )
    : [];

  const updatedConversationsRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE conversations
     SET external_id = CASE
           WHEN external_id IS NULL THEN NULL
           ELSE encode(sha256(external_id::bytea), 'hex')
         END,
         last_message = CASE WHEN last_message IS NULL THEN NULL ELSE '[mensagem anonimizada por LGPD]' END
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
    {
      subjectType: 'contact',
      subjectId: id,
      requestType: 'anonymization',
      actorUserId,
      payload: { reason, redact_messages: input.redact_messages },
      result: {
        conversations_updated: updatedConversationsRows.length,
        messages_redacted: redactedMessagesRows.length,
        anonymized_at: updated.lgpd_anonymized_at?.toISOString() ?? null,
      },
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
): Promise<CreatePortalAccessResult> {
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
): Promise<{ revoked: boolean }> {
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
