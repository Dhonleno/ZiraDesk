import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { prisma } from '../../config/database.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';

interface TempTenant {
  id: string;
  slug: string;
  schemaName: string;
}

interface PortalContactFixture {
  id: string;
  name: string;
  email: string;
  password: string;
}

interface EmailServiceMock {
  sendEmail: ReturnType<typeof vi.fn>;
  hasTenantEmailProvider: ReturnType<typeof vi.fn>;
}

const DEFAULT_PASSWORD = 'Portal#123';
const RESET_PASSWORD = 'Portal#456';

const tempTenants: TempTenant[] = [];
let app: FastifyInstance | null = null;
let emailServiceMock: EmailServiceMock | null = null;
let suiteTenant: TempTenant | null = null;
let suiteContact: PortalContactFixture | null = null;

function requireApp(): FastifyInstance {
  if (!app) {
    throw new Error('App local da suite de portal não inicializado');
  }

  return app;
}

function requireEmailServiceMock(): EmailServiceMock {
  if (!emailServiceMock) {
    throw new Error('Mock de email da suite de portal não inicializado');
  }

  return emailServiceMock;
}

function requireSuiteTenant(): TempTenant {
  if (!suiteTenant) {
    throw new Error('Tenant dedicado da suite de portal não inicializado');
  }

  return suiteTenant;
}

function requireSuiteContact(): PortalContactFixture {
  if (!suiteContact) {
    throw new Error('Contato da suite de portal não inicializado');
  }

  return suiteContact;
}

function portalHost(tenant: TempTenant = requireSuiteTenant()): string {
  return `suporte.${tenant.slug}.ziradesk.local`;
}

function uniqueText(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}@ziradesk.test`.toLowerCase();
}

async function createTempTenant(track = true): Promise<TempTenant> {
  const slug = uniqueText('tenant').toLowerCase();
  const schemaName = uniqueText('schema').toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: {
      name: 'Plano Teste',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: {},
    },
    create: {
      name: 'Plano Teste',
      slug: 'test-plan',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: {},
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${slug}`,
      slug,
      schemaName,
      planId: plan.id,
      status: 'active',
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, slug: true, schemaName: true },
  });

  await provisionTenantSchema(schemaName);

  if (track) {
    tempTenants.push(tenant);
  }

  return tenant;
}

async function dropTenant(tenant: TempTenant): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
}

async function resetTenantPortalData(schemaName: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "${schemaName}".ticket_attachments,
      "${schemaName}".ticket_comments,
      "${schemaName}".ticket_events,
      "${schemaName}".ticket_checklists,
      "${schemaName}".ticket_relations,
      "${schemaName}".ticket_time_entries,
      "${schemaName}".tickets,
      "${schemaName}".ticket_types,
      "${schemaName}".contacts,
      "${schemaName}".organizations,
      "${schemaName}".audit_logs
    RESTART IDENTITY CASCADE
  `);
}

async function createPortalContact(
  schemaName: string,
  overrides: Partial<PortalContactFixture> = {},
): Promise<PortalContactFixture> {
  const contact = {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? uniqueText('Contato portal'),
    email: overrides.email ?? uniqueEmail('portal.contact'),
    password: overrides.password ?? DEFAULT_PASSWORD,
  };

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".contacts
       (id, name, email, portal_enabled, portal_password_hash)
     VALUES ($1::uuid, $2, $3, true, $4)`,
    contact.id,
    contact.name,
    contact.email,
    await bcrypt.hash(contact.password, 12),
  );

  return contact;
}

async function createTicketRecord(
  schemaName: string,
  contactId: string,
  title: string,
  overrides: Partial<{ status: string; source: string; description: string | null }> = {},
): Promise<string> {
  const ticketId = randomUUID();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".tickets
       (id, contact_id, title, description, source, status, priority)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'medium')`,
    ticketId,
    contactId,
    title,
    overrides.description ?? null,
    overrides.source ?? 'portal',
    overrides.status ?? 'open',
  );

  return ticketId;
}

async function buildPortalTestApp(): Promise<{ app: FastifyInstance; emailServiceMock: EmailServiceMock }> {
  vi.resetModules();

  const emailMock: EmailServiceMock = {
    sendEmail: vi.fn(async () => undefined),
    hasTenantEmailProvider: vi.fn(async () => true),
  };

  vi.doMock('../../services/email.service.js', () => emailMock);

  const { portalModuleRoutes } = await import('./index.js');
  const server = Fastify({ logger: false });
  await server.register(portalModuleRoutes, { prefix: '/api/portal' });
  await server.ready();

  return { app: server, emailServiceMock: emailMock };
}

async function portalRequest(options: {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
  query?: Record<string, unknown>;
}): Promise<{ status: number; body: any; headers: Record<string, string | string[] | undefined> }> {
  const response = await requireApp().inject({
    method: options.method,
    url: options.url,
    headers: options.headers,
    payload: options.payload,
    query: options.query,
  });

  return {
    status: response.statusCode,
    body: response.json(),
    headers: response.headers,
  };
}

async function loginPortal(email = requireSuiteContact().email, password = requireSuiteContact().password) {
  return portalRequest({
    method: 'POST',
    url: '/api/portal/auth/login',
    headers: { host: portalHost() },
    payload: { email, password },
  });
}

async function loginAndGetToken(): Promise<string> {
  const response = await loginPortal();
  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  return response.body.token as string;
}

function extractResetToken(html: string): string {
  const match = /\/portal\/reset-password\?token=([^"'\s>]+)/.exec(html);
  if (!match) {
    throw new Error('Token de reset não encontrado no HTML do e-mail');
  }

  return decodeURIComponent(match[1]);
}

async function issuePasswordResetAndCaptureToken(email = requireSuiteContact().email): Promise<string> {
  let capturedToken: string | null = null;

  vi.mocked(requireEmailServiceMock().sendEmail).mockImplementationOnce(async (payload) => {
    capturedToken = extractResetToken(payload.html);
  });

  const response = await portalRequest({
    method: 'POST',
    url: '/api/portal/auth/forgot-password',
    headers: { host: portalHost() },
    payload: { email },
  });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ success: true });
  expect(capturedToken).toEqual(expect.any(String));

  return capturedToken!;
}

describe('Portal integration', () => {
  beforeAll(async () => {
    suiteTenant = await createTempTenant(false);
    const localApp = await buildPortalTestApp();
    app = localApp.app;
    emailServiceMock = localApp.emailServiceMock;
  });

  beforeEach(async () => {
    const { schemaName } = requireSuiteTenant();
    await resetTenantPortalData(schemaName);
    suiteContact = await createPortalContact(schemaName, {
      name: 'Contato Portal Principal',
      email: 'portal.integration@ziradesk.test',
      password: DEFAULT_PASSWORD,
    });
    requireEmailServiceMock().sendEmail.mockReset();
    requireEmailServiceMock().sendEmail.mockResolvedValue(undefined);
    requireEmailServiceMock().hasTenantEmailProvider.mockReset();
    requireEmailServiceMock().hasTenantEmailProvider.mockResolvedValue(true);
  });

  afterEach(async () => {
    while (tempTenants.length > 0) {
      await dropTenant(tempTenants.pop()!);
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close().catch(() => undefined);
      app = null;
    }

    if (!suiteTenant) {
      return;
    }

    await dropTenant(suiteTenant);
    emailServiceMock = null;
    suiteTenant = null;
    suiteContact = null;
  });

  it('POST /api/portal/auth/login com credenciais válidas retorna JWT de 7 dias', async () => {
    const tenant = requireSuiteTenant();
    const contact = requireSuiteContact();

    const response = await loginPortal(contact.email, contact.password);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.contact).toMatchObject({
      id: contact.id,
      name: contact.name,
      email: contact.email,
    });

    const payload = jwt.verify(response.body.token as string, env.JWT_SECRET) as jwt.JwtPayload & {
      contactId: string;
      schemaName: string;
      tenantSlug: string;
      type: string;
    };

    expect(payload).toMatchObject({
      contactId: contact.id,
      schemaName: tenant.schemaName,
      tenantSlug: tenant.slug,
      type: 'portal',
    });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(7 * 24 * 60 * 60);
  });

  it('POST /api/portal/auth/login com credenciais inválidas retorna 401', async () => {
    const response = await loginPortal(requireSuiteContact().email, 'SenhaErrada#999');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('POST /api/portal/auth/forgot-password retorna success true sem revelar existência do email', async () => {
    const response = await portalRequest({
      method: 'POST',
      url: '/api/portal/auth/forgot-password',
      headers: { host: portalHost() },
      payload: { email: uniqueEmail('portal.missing') },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(requireEmailServiceMock().sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/portal/auth/forgot-password com email válido envia email', async () => {
    let payloadSnapshot: {
      tenantId: string;
      tenantSchema: string;
      to: string;
      subject: string;
      html: string;
    } | null = null;

    vi.mocked(requireEmailServiceMock().sendEmail).mockImplementationOnce(async (payload) => {
      payloadSnapshot = payload;
    });

    const response = await portalRequest({
      method: 'POST',
      url: '/api/portal/auth/forgot-password',
      headers: { host: portalHost() },
      payload: { email: requireSuiteContact().email },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(requireEmailServiceMock().sendEmail).toHaveBeenCalledTimes(1);
    expect(payloadSnapshot).toMatchObject({
      tenantId: requireSuiteTenant().id,
      tenantSchema: requireSuiteTenant().schemaName,
      to: requireSuiteContact().email,
      subject: 'Redefinição de senha — Portal de Suporte',
    });
    expect((payloadSnapshot as { html: string }).html).toContain('/portal/reset-password?token=');
  });

  it('POST /api/portal/auth/reset-password com token válido atualiza a senha', async () => {
    const token = await issuePasswordResetAndCaptureToken();

    const response = await portalRequest({
      method: 'POST',
      url: '/api/portal/auth/reset-password',
      payload: { token, password: RESET_PASSWORD },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    const rows = await prisma.$queryRawUnsafe<Array<{ portal_password_hash: string | null }>>(
      `SELECT portal_password_hash
       FROM "${requireSuiteTenant().schemaName}".contacts
       WHERE id = $1::uuid`,
      requireSuiteContact().id,
    );

    expect(rows[0]?.portal_password_hash).toEqual(expect.any(String));
    expect(await bcrypt.compare(RESET_PASSWORD, rows[0]!.portal_password_hash!)).toBe(true);

    const oldLogin = await loginPortal(requireSuiteContact().email, DEFAULT_PASSWORD);
    expect(oldLogin.status).toBe(401);

    const newLogin = await loginPortal(requireSuiteContact().email, RESET_PASSWORD);
    expect(newLogin.status).toBe(200);
  });

  it('POST /api/portal/auth/reset-password com token expirado retorna 400', async () => {
    const expiredToken = jwt.sign(
      {
        sub: requireSuiteContact().id,
        schemaName: requireSuiteTenant().schemaName,
        tenantSlug: requireSuiteTenant().slug,
        type: 'portal-reset',
      },
      env.JWT_SECRET,
      { expiresIn: -10 },
    );

    const response = await portalRequest({
      method: 'POST',
      url: '/api/portal/auth/reset-password',
      payload: { token: expiredToken, password: RESET_PASSWORD },
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('POST /api/portal/auth/reset-password com token de tipo errado retorna 400', async () => {
    const wrongTypeToken = jwt.sign(
      {
        sub: requireSuiteContact().id,
        schemaName: requireSuiteTenant().schemaName,
        tenantSlug: requireSuiteTenant().slug,
        type: 'portal',
      },
      env.JWT_SECRET,
      { expiresIn: '1h' },
    );

    const response = await portalRequest({
      method: 'POST',
      url: '/api/portal/auth/reset-password',
      payload: { token: wrongTypeToken, password: RESET_PASSWORD },
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('GET /api/portal/tickets lista tickets do contato autenticado', async () => {
    const schemaName = requireSuiteTenant().schemaName;
    const ownTicketId = await createTicketRecord(schemaName, requireSuiteContact().id, 'Ticket do contato autenticado');
    const otherContact = await createPortalContact(schemaName, {
      email: uniqueEmail('portal.other'),
      name: 'Outro contato',
    });
    await createTicketRecord(schemaName, otherContact.id, 'Ticket de outro contato', { status: 'resolved' });
    const token = await loginAndGetToken();

    const response = await portalRequest({
      method: 'GET',
      url: '/api/portal/tickets',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.total).toBe(1);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: ownTicketId,
      title: 'Ticket do contato autenticado',
      source: 'portal',
    });
  });

  it('POST /api/portal/tickets cria ticket vinculado ao contato autenticado', async () => {
    const token = await loginAndGetToken();

    const response = await portalRequest({
      method: 'POST',
      url: '/api/portal/tickets',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Chamado criado via portal',
        description: 'Solicitação aberta pelo contato autenticado',
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      title: 'Chamado criado via portal',
      status: 'open',
      source: 'portal',
    });

    const rows = await prisma.$queryRawUnsafe<Array<{ contact_id: string | null; source: string; title: string }>>(
      `SELECT contact_id, source, title
       FROM "${requireSuiteTenant().schemaName}".tickets
       WHERE id = $1::uuid`,
      response.body.data.id,
    );

    expect(rows[0]).toMatchObject({
      contact_id: requireSuiteContact().id,
      source: 'portal',
      title: 'Chamado criado via portal',
    });
  });
});