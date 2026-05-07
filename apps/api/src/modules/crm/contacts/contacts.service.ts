import { prisma } from '../../../config/database.js';
import type { CreateContactInput, UpdateContactInput, ListContactsQuery } from './contacts.schema.js';
import bcrypt from 'bcryptjs';

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
  tags: string[];
  custom_fields: unknown;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ContactStatsRow {
  contact_exists: boolean;
  total_conversations: bigint;
  total_messages: bigint;
  open_tickets: bigint;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toPgArray(arr: string[]): string {
  if (!arr.length) return '{}';
  return '{' + arr.map(t => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',') + '}';
}

const BASE_SELECT = `
  SELECT
    ct.id, ct.organization_id, ct.name, ct.email, ct.phone, ct.whatsapp,
    ct.document, ct.role, ct.department, ct.is_primary, ct.avatar_url,
    ct.portal_enabled, ct.portal_last_login, ct.portal_invited_at,
    ct.tags, ct.custom_fields, ct.notes, ct.created_at, ct.updated_at,
    o.name   AS organization_name,
    o.status AS organization_status
  FROM contacts ct
  LEFT JOIN organizations o ON o.id = ct.organization_id`;

/* ── listContacts ────────────────────────────────────────────────────────── */
export async function listContacts(query: ListContactsQuery) {
  const { page, per_page, organization_id, search, standalone_only } = query;
  const offset = (page - 1) * per_page;

  const rows = await prisma.$queryRawUnsafe<ContactRow[]>(
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

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
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
export async function getContact(id: string) {
  const rows = await prisma.$queryRawUnsafe<ContactRow[]>(
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
  const rows = await prisma.$queryRawUnsafe<ContactRow[]>(
    `${BASE_SELECT}
     WHERE ct.whatsapp = $1 OR ct.phone = $1
     LIMIT 1`,
    number,
  );
  return rows[0] ?? null;
}

/* ── createContact ───────────────────────────────────────────────────────── */
export async function createContact(data: CreateContactInput, createdBy: string) {
  if (data.is_primary && data.organization_id) {
    await prisma.$executeRawUnsafe(
      `UPDATE contacts SET is_primary = false WHERE organization_id = $1::uuid AND is_primary = true`,
      data.organization_id,
    );
  }

  const tagsLiteral    = toPgArray(data.tags ?? []);
  const customFieldsJson = JSON.stringify(data.custom_fields ?? {});

  const rows = await prisma.$queryRawUnsafe<ContactRow[]>(
    `INSERT INTO contacts (
       organization_id, name, email, phone, whatsapp, document,
       role, department, is_primary, tags, custom_fields, notes
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11::jsonb, $12)
     RETURNING *`,
    data.organization_id ?? null, data.name, data.email ?? null, data.phone ?? null,
    data.whatsapp ?? null, data.document ?? null, data.role ?? null, data.department ?? null,
    data.is_primary ?? false, tagsLiteral, customFieldsJson, data.notes ?? null,
  );

  const contact = rows[0]!;

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'contact.created', 'contact', $2::uuid, $3::jsonb)`,
    createdBy, contact.id, JSON.stringify(contact),
  );

  return contact;
}

/* ── updateContact ───────────────────────────────────────────────────────── */
export async function updateContact(id: string, data: UpdateContactInput, updatedBy: string) {
  const existing = await getContact(id);

  if (data.is_primary === true) {
    const orgId = data.organization_id ?? existing.organization_id;
    if (orgId) {
      await prisma.$executeRawUnsafe(
        `UPDATE contacts SET is_primary = false WHERE organization_id = $1::uuid AND id != $2::uuid AND is_primary = true`,
        orgId, id,
      );
    }
  }

  const tagsLiteral    = data.tags !== undefined ? toPgArray(data.tags) : null;
  const customFieldsJson = data.custom_fields !== undefined ? JSON.stringify(data.custom_fields) : null;

  const rows = await prisma.$queryRawUnsafe<ContactRow[]>(
    `UPDATE contacts SET
       organization_id = COALESCE($1::uuid,   organization_id),
       name            = COALESCE($2,          name),
       email           = COALESCE($3,          email),
       phone           = COALESCE($4,          phone),
       whatsapp        = COALESCE($5,          whatsapp),
       document        = COALESCE($6,          document),
       role            = COALESCE($7,          role),
       department      = COALESCE($8,          department),
       is_primary      = COALESCE($9,          is_primary),
       tags            = COALESCE($10::text[], tags),
       custom_fields   = COALESCE($11::jsonb,  custom_fields),
       notes           = COALESCE($12,         notes),
       updated_at      = NOW()
     WHERE id = $13::uuid
     RETURNING *`,
    data.organization_id ?? null, data.name ?? null, data.email ?? null, data.phone ?? null,
    data.whatsapp ?? null, data.document ?? null, data.role ?? null, data.department ?? null,
    data.is_primary ?? null, tagsLiteral, customFieldsJson, data.notes ?? null, id,
  );

  if (!rows[0]) throw new NotFoundError('Contato');
  const updated = rows[0];

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'contact.updated', 'contact', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy, id, JSON.stringify(existing), JSON.stringify(updated),
  );

  return updated;
}

/* ── deleteContact ───────────────────────────────────────────────────────── */
export async function deleteContact(id: string, deletedBy: string) {
  const existing = await getContact(id);

  const linked = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM conversations
     WHERE contact_id = $1::uuid
       AND status IN ('open', 'pending', 'bot')`,
    id,
  );

  if (Number(linked[0]?.count ?? 0) > 0) {
    throw new ConflictError('Contato possui conversas ativas. Encerre-as antes de excluir.');
  }

  await prisma.$executeRawUnsafe(`DELETE FROM contacts WHERE id = $1::uuid`, id);

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data)
     VALUES ($1::uuid, 'contact.deleted', 'contact', $2::uuid, $3::jsonb)`,
    deletedBy, id, JSON.stringify(existing),
  );

  return existing;
}

/* ── linkToOrganization ──────────────────────────────────────────────────── */
export async function linkToOrganization(contactId: string, organizationId: string, updatedBy: string) {
  const existing = await getContact(contactId);

  await prisma.$executeRawUnsafe(
    `UPDATE contacts SET organization_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
    organizationId, contactId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'contact.linked', 'contact', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy, contactId, JSON.stringify(existing), JSON.stringify({ organization_id: organizationId }),
  );

  return getContact(contactId);
}

function generateTemporaryPassword(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return password;
}

export async function createPortalAccess(contactId: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
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

  await prisma.$executeRawUnsafe(
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

export async function revokePortalAccess(contactId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
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
