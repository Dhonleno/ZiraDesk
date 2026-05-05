import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { getSocketServer } from '../../socket/index.js';
import type {
  PortalAddCommentInput,
  PortalCreateTicketInput,
  PortalLoginInput,
  PortalTicketsQuery,
} from './portal.schema.js';

const PORTAL_TOKEN_TTL = '7d';

export class PortalAuthError extends Error {}
export class PortalNotFoundError extends Error {}
export class PortalForbiddenError extends Error {}

export interface PortalJwtPayload {
  contactId: string;
  tenantId: string;
  schemaName: string;
  tenantSlug: string;
  organizationId: string | null;
  type: 'portal';
  exp?: number;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function resolveHostTenant(host: string, fallbackTenantSlug?: string): { isPortal: boolean; tenantSlug: string | null } {
  const hostName = (host ?? '').split(':')[0]?.toLowerCase() ?? '';
  const parts = hostName.split('.').filter(Boolean);

  if (parts[0] === 'suporte' && parts[1]) {
    return { isPortal: true, tenantSlug: parts[1] };
  }

  if ((hostName === 'localhost' || hostName === '127.0.0.1') && fallbackTenantSlug) {
    return { isPortal: true, tenantSlug: fallbackTenantSlug };
  }

  return { isPortal: false, tenantSlug: null };
}

async function getTenantBySlug(slug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, schemaName: true, status: true },
  });

  if (!tenant) throw new PortalNotFoundError('Tenant não encontrado');
  if (tenant.status !== 'active' && tenant.status !== 'trial') {
    throw new PortalForbiddenError('Conta suspensa ou cancelada');
  }

  return tenant;
}

async function ensurePortalInfrastructure(schemaName: string): Promise<void> {
  const schema = quoteIdent(schemaName);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.contacts
    ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS portal_password_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS portal_last_login TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS portal_invited_at TIMESTAMPTZ
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.ticket_comments
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES ${schema}.contacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'agent'
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.ticket_comments
    ALTER COLUMN user_id DROP NOT NULL
  `);
}

export async function portalLogin(host: string, payload: PortalLoginInput) {
  const hostInfo = resolveHostTenant(host, payload.tenant_slug);
  if (!hostInfo.isPortal || !hostInfo.tenantSlug) {
    throw new PortalAuthError('Acesso inválido');
  }

  const tenant = await getTenantBySlug(hostInfo.tenantSlug);
  await ensurePortalInfrastructure(tenant.schemaName);
  const schema = quoteIdent(tenant.schemaName);

  const contacts = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    email: string;
    organization_id: string | null;
    portal_enabled: boolean;
    portal_password_hash: string | null;
  }>>(
    `SELECT id, name, email, organization_id, portal_enabled, portal_password_hash
     FROM ${schema}.contacts
     WHERE LOWER(email) = LOWER($1)
       AND portal_enabled = true
     LIMIT 1`,
    payload.email,
  );

  const contact = contacts[0];
  if (!contact || !contact.portal_password_hash) {
    throw new PortalAuthError('E-mail ou senha inválidos');
  }

  const validPassword = await bcrypt.compare(payload.password, contact.portal_password_hash);
  if (!validPassword) {
    throw new PortalAuthError('E-mail ou senha inválidos');
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.contacts
     SET portal_last_login = NOW()
     WHERE id = $1::uuid`,
    contact.id,
  );

  const token = jwt.sign(
    {
      contactId: contact.id,
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
      tenantSlug: tenant.slug,
      organizationId: contact.organization_id,
      type: 'portal',
    } satisfies PortalJwtPayload,
    env.JWT_SECRET,
    { expiresIn: PORTAL_TOKEN_TTL },
  );

  return {
    token,
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
    },
  };
}

export async function verifyPortalToken(token: string): Promise<PortalJwtPayload> {
  const decoded = jwt.verify(token, env.JWT_SECRET) as PortalJwtPayload;
  if (decoded.type !== 'portal') {
    throw new PortalAuthError('Token inválido');
  }
  await ensurePortalInfrastructure(decoded.schemaName);
  return decoded;
}

export async function portalMe(portalUser: PortalJwtPayload) {
  const schema = quoteIdent(portalUser.schemaName);
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    role: string | null;
    department: string | null;
    organization_id: string | null;
    organization_name: string | null;
  }>>(
    `SELECT
       c.id,
       c.name,
       c.email,
       c.phone,
       c.whatsapp,
       c.role,
       c.department,
       o.id AS organization_id,
       o.name AS organization_name
     FROM ${schema}.contacts c
     LEFT JOIN ${schema}.organizations o ON o.id = c.organization_id
     WHERE c.id = $1::uuid
       AND c.portal_enabled = true
     LIMIT 1`,
    portalUser.contactId,
  );

  const contact = rows[0];
  if (!contact) throw new PortalNotFoundError('Contato não encontrado');
  return contact;
}

export async function listPortalTickets(portalUser: PortalJwtPayload, query: PortalTicketsQuery) {
  const schema = quoteIdent(portalUser.schemaName);
  const offset = (query.page - 1) * query.per_page;

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    created_at: Date;
    updated_at: Date;
    resolved_at: Date | null;
    type_name: string | null;
    type_icon: string | null;
    type_color: string | null;
    assigned_name: string | null;
  }>>(
    `SELECT
       t.id,
       t.title,
       t.status,
       t.priority,
       t.created_at,
       t.updated_at,
       t.resolved_at,
       tt.name AS type_name,
       tt.icon AS type_icon,
       tt.color AS type_color,
       u.name AS assigned_name
     FROM ${schema}.tickets t
     LEFT JOIN ${schema}.ticket_types tt ON tt.id = t.type_id
     LEFT JOIN ${schema}.users u ON u.id = t.assigned_to
     WHERE (
       t.contact_id = $1::uuid
       OR ($2::uuid IS NOT NULL AND t.organization_id = $2::uuid)
     )
       AND ($3::text IS NULL OR t.status = $3::text)
     ORDER BY t.created_at DESC
     LIMIT $4 OFFSET $5`,
    portalUser.contactId,
    portalUser.organizationId,
    query.status ?? null,
    query.per_page,
    offset,
  );

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count
     FROM ${schema}.tickets t
     WHERE (
       t.contact_id = $1::uuid
       OR ($2::uuid IS NOT NULL AND t.organization_id = $2::uuid)
     )
       AND ($3::text IS NULL OR t.status = $3::text)`,
    portalUser.contactId,
    portalUser.organizationId,
    query.status ?? null,
  );

  return {
    data: rows,
    total: Number(countRows[0]?.count ?? 0),
    page: query.page,
    per_page: query.per_page,
  };
}

export async function getPortalTicket(portalUser: PortalJwtPayload, ticketId: string) {
  const schema = quoteIdent(portalUser.schemaName);

  const tickets = await prisma.$queryRawUnsafe<Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    type_id: string | null;
    type_name: string | null;
    type_icon: string | null;
    type_color: string | null;
    assigned_name: string | null;
    contact_name: string | null;
    created_at: Date;
    updated_at: Date;
    resolved_at: Date | null;
  }>>(
    `SELECT
       t.id,
       t.title,
       t.description,
       t.status,
       t.priority,
       t.type_id,
       tt.name AS type_name,
       tt.icon AS type_icon,
       tt.color AS type_color,
       u.name AS assigned_name,
       ct.name AS contact_name,
       t.created_at,
       t.updated_at,
       t.resolved_at
     FROM ${schema}.tickets t
     LEFT JOIN ${schema}.ticket_types tt ON tt.id = t.type_id
     LEFT JOIN ${schema}.users u ON u.id = t.assigned_to
     LEFT JOIN ${schema}.contacts ct ON ct.id = t.contact_id
     WHERE t.id = $1::uuid
       AND (
         t.contact_id = $2::uuid
         OR ($3::uuid IS NOT NULL AND t.organization_id = $3::uuid)
       )
     LIMIT 1`,
    ticketId,
    portalUser.contactId,
    portalUser.organizationId,
  );

  const ticket = tickets[0];
  if (!ticket) throw new PortalNotFoundError('Ticket não encontrado');

  const comments = await prisma.$queryRawUnsafe<Array<{
    id: string;
    content: string;
    created_at: Date;
    user_name: string | null;
    role: string | null;
    source: string | null;
  }>>(
    `SELECT
       tc.id,
       tc.content,
       tc.created_at,
       COALESCE(c.name, u.name) AS user_name,
       u.role,
       tc.source
     FROM ${schema}.ticket_comments tc
     LEFT JOIN ${schema}.users u ON u.id = tc.user_id
     LEFT JOIN ${schema}.contacts c ON c.id = tc.contact_id
     WHERE tc.ticket_id = $1::uuid
       AND tc.is_internal = false
     ORDER BY tc.created_at ASC`,
    ticketId,
  );

  return {
    ...ticket,
    comments,
  };
}

export async function listPortalTicketTypes(portalUser: PortalJwtPayload) {
  const schema = quoteIdent(portalUser.schemaName);
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    icon: string;
    color: string;
  }>>(
    `SELECT id, name, icon, color
     FROM ${schema}.ticket_types
     WHERE is_active = true
     ORDER BY sort_order, name`,
  );
  return rows;
}

export async function createPortalTicket(portalUser: PortalJwtPayload, payload: PortalCreateTicketInput) {
  const schema = quoteIdent(portalUser.schemaName);

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    title: string;
    status: string;
    created_at: Date;
  }>>(
    `INSERT INTO ${schema}.tickets (
       title,
       description,
       status,
       priority,
       contact_id,
       organization_id,
       type_id,
       created_at,
       updated_at
     ) VALUES (
       $1,
       $2,
       'open',
       'medium',
       $3::uuid,
       $4::uuid,
       $5::uuid,
       NOW(),
       NOW()
     )
     RETURNING id, title, status, created_at`,
    payload.title,
    payload.description ?? null,
    portalUser.contactId,
    portalUser.organizationId,
    payload.type_id ?? null,
  );

  const ticket = rows[0];
  if (!ticket) throw new PortalNotFoundError('Falha ao criar ticket');

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.ticket_events (ticket_id, event_type, new_value)
     VALUES ($1::uuid, 'created', 'portal')`,
    ticket.id,
  );

  try {
    getSocketServer().to(`tenant:${portalUser.tenantId}`).emit('ticket:created', {
      ticket: { id: ticket.id, title: ticket.title, status: ticket.status },
      source: 'portal',
    });
  } catch {
    // socket pode não estar disponível em testes
  }

  return ticket;
}

export async function addPortalComment(
  portalUser: PortalJwtPayload,
  ticketId: string,
  payload: PortalAddCommentInput,
) {
  const schema = quoteIdent(portalUser.schemaName);

  const tickets = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${schema}.tickets
     WHERE id = $1::uuid
       AND (
         contact_id = $2::uuid
         OR ($3::uuid IS NOT NULL AND organization_id = $3::uuid)
       )
     LIMIT 1`,
    ticketId,
    portalUser.contactId,
    portalUser.organizationId,
  );

  if (!tickets[0]) throw new PortalNotFoundError('Ticket não encontrado');

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    ticket_id: string;
    content: string;
    is_internal: boolean;
    created_at: Date;
    source: string;
  }>>(
    `INSERT INTO ${schema}.ticket_comments (
       ticket_id,
       user_id,
       contact_id,
       source,
       content,
       is_internal,
       created_at
     ) VALUES (
       $1::uuid,
       NULL,
       $2::uuid,
       'portal',
       $3,
       false,
       NOW()
     )
     RETURNING id, ticket_id, content, is_internal, created_at, source`,
    ticketId,
    portalUser.contactId,
    payload.content,
  );

  const comment = rows[0];
  if (!comment) throw new PortalNotFoundError('Falha ao registrar comentário');

  try {
    getSocketServer().to(`tenant:${portalUser.tenantId}`).emit('ticket:comment_added', {
      comment: {
        id: comment.id,
        ticket_id: comment.ticket_id,
        content: comment.content,
        is_internal: comment.is_internal,
        created_at: comment.created_at,
        source: comment.source,
      },
    });
  } catch {
    // socket pode não estar disponível em testes
  }

  return { success: true };
}
