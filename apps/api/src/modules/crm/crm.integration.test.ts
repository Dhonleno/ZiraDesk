import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';
import { ensureCrmInfrastructure } from './crm.infrastructure.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

const TEST_USER_ID = '00000000-0000-0000-0000-000000000021';
const TEST_USER_NAME = 'CRM Integration User';
const TEST_USER_EMAIL = 'crm.integration@ziradesk.test';
const tempTenants: TempTenant[] = [];
let suiteTenant: TempTenant | null = null;

function requireSuiteTenant(): TempTenant {
  if (!suiteTenant) {
    throw new Error('Tenant dedicado da suite de CRM não inicializado');
  }

  return suiteTenant;
}

function authHeader(
  tenant: TempTenant = requireSuiteTenant(),
  overrides: Parameters<typeof createTestJWT>[0] = {},
): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      name: TEST_USER_NAME,
      role: 'owner',
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
      ...overrides,
    })}`,
  };
}

function uniqueText(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}@ziradesk.test`.toLowerCase();
}

function uniquePhone(seed: number): string {
  return `+55119${seed.toString().padStart(8, '0')}`;
}

function uniqueDocument(seed: number): string {
  return `${seed.toString().padStart(11, '0')}`;
}

function uniqueProtocol(): string {
  return `ZD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 10_000).toString().padStart(4, '0')}`;
}

async function ensureTenantUser(schemaName: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".users
       (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, $2, $3, $4, 'owner', 'active', 'pt-BR', '{}'::jsonb)
     ON CONFLICT (id)
     DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       role = 'owner',
       status = 'active',
       language = 'pt-BR',
       settings = '{}'::jsonb`,
    TEST_USER_ID,
    TEST_USER_NAME,
    TEST_USER_EMAIL,
    'not_used_in_jwt_tests',
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".agent_assignments (user_id)
     VALUES ($1::uuid)
     ON CONFLICT (user_id) DO NOTHING`,
    TEST_USER_ID,
  );
}

async function resetTenantCrmData(schemaName: string): Promise<void> {
  await ensureCrmInfrastructure(schemaName);

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "${schemaName}".messages,
      "${schemaName}".conversations,
      "${schemaName}".ticket_attachments,
      "${schemaName}".ticket_comments,
      "${schemaName}".ticket_events,
      "${schemaName}".ticket_checklists,
      "${schemaName}".ticket_relations,
      "${schemaName}".tickets,
      "${schemaName}".lgpd_requests,
      "${schemaName}".contacts,
      "${schemaName}".organizations,
      "${schemaName}".audit_logs
    RESTART IDENTITY CASCADE
  `);

  await ensureTenantUser(schemaName);
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
    select: { id: true, schemaName: true },
  });

  await provisionTenantSchema(schemaName);
  await ensureTenantUser(schemaName);

  if (track) {
    tempTenants.push(tenant);
  }

  return tenant;
}

async function dropTenant(tenant: TempTenant): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
}

async function createOrganization(
  payload: Record<string, unknown> = {},
  tenant: TempTenant = requireSuiteTenant(),
) {
  const response = await createTestApp()
    .post('/api/crm/organizations')
    .set(authHeader(tenant))
    .send({
      name: uniqueText('Organizacao'),
      status: 'lead',
      ...payload,
    });

  expect(response.status).toBe(201);

  return response.body.data as {
    id: string;
    name: string;
    status: string;
    segment: string | null;
    tags: string[];
    email: string | null;
  };
}

async function createContact(
  payload: Record<string, unknown> = {},
  tenant: TempTenant = requireSuiteTenant(),
) {
  const response = await createTestApp()
    .post('/api/crm/contacts')
    .set(authHeader(tenant))
    .send({
      name: uniqueText('Contato'),
      email: uniqueEmail('crm.contact'),
      phone: uniquePhone(Math.floor(Math.random() * 9_999_999)),
      document: uniqueDocument(Math.floor(Math.random() * 9_999_999)),
      ...payload,
    });

  expect(response.status).toBe(201);

  return response.body.data as {
    id: string;
    organization_id: string | null;
    organization_name: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    document: string | null;
    portal_enabled: boolean;
  };
}

async function loadPortalState(schemaName: string, contactId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    portal_enabled: boolean;
    portal_password_hash: string | null;
    portal_invited_at: Date | null;
  }>>(
    `SELECT portal_enabled, portal_password_hash, portal_invited_at
     FROM "${schemaName}".contacts
     WHERE id = $1::uuid`,
    contactId,
  );

  return rows[0] ?? null;
}

describe('CRM integration', () => {
  beforeAll(async () => {
    suiteTenant = await createTempTenant(false);
  });

  beforeEach(async () => {
    const { schemaName } = requireSuiteTenant();
    await resetTenantCrmData(schemaName);
  });

  afterEach(async () => {
    while (tempTenants.length > 0) {
      const tenant = tempTenants.pop()!;
      await dropTenant(tenant);
    }
  });

  afterAll(async () => {
    if (!suiteTenant) {
      return;
    }

    await dropTenant(suiteTenant);
    suiteTenant = null;
  });

  it('POST /api/crm/organizations cria organização', async () => {
    const response = await createTestApp()
      .post('/api/crm/organizations')
      .set(authHeader())
      .send({
        name: uniqueText('Acme'),
        status: 'client',
        segment: 'saas',
        email: uniqueEmail('acme'),
        phone: uniquePhone(101),
        tags: ['vip', 'expansao'],
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      name: expect.stringContaining('Acme'),
      status: 'client',
      segment: 'saas',
      tags: ['vip', 'expansao'],
    });
  });

  it('GET /api/crm/organizations com filtros de status, segment e tag retorna corretos', async () => {
    const matching = await createOrganization({
      name: uniqueText('Match'),
      status: 'client',
      segment: 'saas',
      tags: ['vip', 'enterprise'],
    });

    await createOrganization({
      name: uniqueText('Wrong status'),
      status: 'lead',
      segment: 'saas',
      tags: ['vip'],
    });
    await createOrganization({
      name: uniqueText('Wrong segment'),
      status: 'client',
      segment: 'retail',
      tags: ['vip'],
    });
    await createOrganization({
      name: uniqueText('Wrong tag'),
      status: 'client',
      segment: 'saas',
      tags: ['basic'],
    });

    const response = await createTestApp()
      .get('/api/crm/organizations')
      .query({
        status: 'client',
        segment: 'saas',
        tag: 'vip',
      })
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ total: 1, page: 1, per_page: 20, total_pages: 1 });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: matching.id,
      status: 'client',
      segment: 'saas',
      tags: ['vip', 'enterprise'],
    });
  });

  it('GET /api/crm/organizations/:id/stats retorna métricas agregadas', async () => {
    const tenant = requireSuiteTenant();
    const organization = await createOrganization({
      name: uniqueText('Stats org'),
      status: 'client',
    });
    const primaryContact = await createContact({
      name: 'Contato Primario',
      email: uniqueEmail('stats.primary'),
      phone: uniquePhone(201),
      document: uniqueDocument(201),
      organization_id: organization.id,
      is_primary: true,
    });
    const secondaryContact = await createContact({
      name: 'Contato Secundario',
      email: uniqueEmail('stats.secondary'),
      phone: uniquePhone(202),
      document: uniqueDocument(202),
      organization_id: organization.id,
    });

    const openConversationId = randomUUID();
    const closedConversationId = randomUUID();
    const openTicketId = randomUUID();
    const resolvedTicketId = randomUUID();
    const lastContactAt = new Date('2026-05-24T10:30:00.000Z');

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".conversations
         (id, contact_id, organization_id, channel_type, protocol_number, status, subject, last_message, last_message_at)
       VALUES
         ($1::uuid, $2::uuid, $3::uuid, 'whatsapp', $4, 'open', 'Suporte ativo', 'Mensagem aberta', NOW()),
         ($5::uuid, $6::uuid, $7::uuid, 'email', $8, 'closed', 'Caso encerrado', 'Mensagem fechada', NOW())`,
      openConversationId,
      primaryContact.id,
      organization.id,
      uniqueProtocol(),
      closedConversationId,
      secondaryContact.id,
      organization.id,
      uniqueProtocol(),
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".messages
         (conversation_id, sender_type, content, status, created_at)
       VALUES ($1::uuid, 'contact', 'Primeiro contato', 'sent', $2::timestamptz)`,
      openConversationId,
      lastContactAt,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".tickets
         (id, contact_id, organization_id, title, status, priority)
       VALUES
         ($1::uuid, $2::uuid, $3::uuid, $4, 'open', 'high'),
         ($5::uuid, $6::uuid, $7::uuid, $8, 'resolved', 'low')`,
      openTicketId,
      primaryContact.id,
      organization.id,
      uniqueText('Ticket aberto'),
      resolvedTicketId,
      secondaryContact.id,
      organization.id,
      uniqueText('Ticket resolvido'),
    );

    const response = await createTestApp()
      .get(`/api/crm/organizations/${organization.id}/stats`)
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      total_contacts: 2,
      total_conversations: 2,
      open_conversations: 1,
      total_tickets: 2,
      open_tickets: 1,
      last_contact_at: lastContactAt.toISOString(),
    });
  });

  it('GET /api/crm/organizations/:id/contacts lista contatos vinculados', async () => {
    const organization = await createOrganization({ name: uniqueText('Org contatos') });
    const primary = await createContact({
      name: 'Bruno Primario',
      email: uniqueEmail('org.primary'),
      phone: uniquePhone(301),
      document: uniqueDocument(301),
      organization_id: organization.id,
      is_primary: true,
    });
    const secondary = await createContact({
      name: 'Alice Secundaria',
      email: uniqueEmail('org.secondary'),
      phone: uniquePhone(302),
      document: uniqueDocument(302),
      organization_id: organization.id,
    });

    const response = await createTestApp()
      .get(`/api/crm/organizations/${organization.id}/contacts`)
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.map((contact: { id: string }) => contact.id)).toEqual([primary.id, secondary.id]);
    expect(response.body.data[0]).toMatchObject({ id: primary.id, is_primary: true });
    expect(response.body.data[1]).toMatchObject({ id: secondary.id, is_primary: false });
  });

  it('PATCH /api/crm/organizations/:id atualiza campos', async () => {
    const organization = await createOrganization({
      name: uniqueText('Update org'),
      status: 'lead',
      segment: 'services',
      tags: ['cold'],
    });

    const response = await createTestApp()
      .patch(`/api/crm/organizations/${organization.id}`)
      .set(authHeader())
      .send({
        name: uniqueText('Update org final'),
        status: 'client',
        segment: 'enterprise',
        tags: ['vip', 'upsell'],
        notes: 'Conta prioritaria',
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: organization.id,
      status: 'client',
      segment: 'enterprise',
      tags: ['vip', 'upsell'],
      notes: 'Conta prioritaria',
    });
    expect(response.body.data.name).toContain('Update org final');
  });

  it('DELETE /api/crm/organizations/:id remove organização', async () => {
    const organization = await createOrganization({
      name: uniqueText('Delete org'),
      status: 'client',
    });

    const response = await createTestApp()
      .delete(`/api/crm/organizations/${organization.id}`)
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      id: organization.id,
      status: 'inactive',
    });
  });

  it('POST /api/crm/contacts cria contato', async () => {
    const response = await createTestApp()
      .post('/api/crm/contacts')
      .set(authHeader())
      .send({
        name: 'Marina Contato',
        email: uniqueEmail('marina'),
        phone: uniquePhone(401),
        document: uniqueDocument(401),
        role: 'Financeiro',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      name: 'Marina Contato',
      role: 'Financeiro',
      portal_enabled: false,
    });
    expect(response.body.data.whatsapp).toBe(uniquePhone(401));
  });

  it('Email, phone e document duplicados no mesmo tenant retornam 409', async () => {
    const duplicateEmail = uniqueEmail('duplicate');
    const duplicatePhone = uniquePhone(501);
    const duplicateDocument = uniqueDocument(501);

    await createContact({
      name: 'Contato Base',
      email: duplicateEmail,
      phone: duplicatePhone,
      document: duplicateDocument,
    });

    const emailResponse = await createTestApp()
      .post('/api/crm/contacts')
      .set(authHeader())
      .send({
        name: 'Contato Email Duplicado',
        email: duplicateEmail,
        phone: uniquePhone(502),
        document: uniqueDocument(502),
      });

    const phoneResponse = await createTestApp()
      .post('/api/crm/contacts')
      .set(authHeader())
      .send({
        name: 'Contato Telefone Duplicado',
        email: uniqueEmail('duplicate.phone'),
        phone: duplicatePhone,
        document: uniqueDocument(503),
      });

    const documentResponse = await createTestApp()
      .post('/api/crm/contacts')
      .set(authHeader())
      .send({
        name: 'Contato Documento Duplicado',
        email: uniqueEmail('duplicate.document'),
        phone: uniquePhone(504),
        document: duplicateDocument,
      });

    expect(emailResponse.status).toBe(409);
    expect(phoneResponse.status).toBe(409);
    expect(documentResponse.status).toBe(409);
  });

  it('POST /api/crm/contacts/:id/link-organization vincula organização', async () => {
    const organization = await createOrganization({ name: uniqueText('Linked org') });
    const contact = await createContact({
      name: 'Contato Solto',
      email: uniqueEmail('link.org'),
      phone: uniquePhone(601),
      document: uniqueDocument(601),
    });

    const response = await createTestApp()
      .post(`/api/crm/contacts/${contact.id}/link-organization`)
      .set(authHeader())
      .send({ organization_id: organization.id });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: contact.id,
      organization_id: organization.id,
      organization_name: organization.name,
    });
  });

  it('POST /api/crm/contacts/:id/portal-access habilita portal', async () => {
    const tenant = requireSuiteTenant();
    const contact = await createContact({
      name: 'Contato Portal',
      email: uniqueEmail('portal'),
      phone: uniquePhone(701),
      document: uniqueDocument(701),
    });

    const response = await createTestApp()
      .post(`/api/crm/contacts/${contact.id}/portal-access`)
      .set(authHeader())
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Acesso criado e e-mail enviado',
      data: {
        email: contact.email,
        portal_url: 'http://localhost:5173/portal',
      },
    });
    expect(response.body.data.temp_password).toMatch(/^[A-Z2-9]{8}$/);

    const portalState = await loadPortalState(tenant.schemaName, contact.id);
    expect(portalState).not.toBeNull();
    expect(portalState).toMatchObject({ portal_enabled: true });
    expect(portalState?.portal_password_hash).toEqual(expect.any(String));
    expect(portalState?.portal_invited_at).toBeInstanceOf(Date);
  });

  it('DELETE /api/crm/contacts/:id/portal-access desabilita portal', async () => {
    const tenant = requireSuiteTenant();
    const contact = await createContact({
      name: 'Contato Portal Revoke',
      email: uniqueEmail('portal.revoke'),
      phone: uniquePhone(702),
      document: uniqueDocument(702),
    });

    const enableResponse = await createTestApp()
      .post(`/api/crm/contacts/${contact.id}/portal-access`)
      .set(authHeader())
      .send();

    expect(enableResponse.status).toBe(200);

    const response = await createTestApp()
      .delete(`/api/crm/contacts/${contact.id}/portal-access`)
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { revoked: true },
    });

    const portalState = await loadPortalState(tenant.schemaName, contact.id);
    expect(portalState).not.toBeNull();
    expect(portalState).toMatchObject({ portal_enabled: false, portal_password_hash: null });
  });

  it('Contato do tenant A não é acessível com JWT do tenant B', async () => {
    const tenantB = await createTempTenant();
    const contact = await createContact({
      name: 'Contato Tenant A',
      email: uniqueEmail('tenant.a'),
      phone: uniquePhone(801),
      document: uniqueDocument(801),
    });

    const response = await createTestApp()
      .get(`/api/crm/contacts/${contact.id}`)
      .set(authHeader(tenantB));

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it('E-mail duplicado é validado por tenant, não globalmente', async () => {
    const tenantB = await createTempTenant();
    const sharedEmail = uniqueEmail('shared.tenant');

    const firstResponse = await createTestApp()
      .post('/api/crm/contacts')
      .set(authHeader())
      .send({
        name: 'Contato Tenant A',
        email: sharedEmail,
        phone: uniquePhone(901),
        document: uniqueDocument(901),
      });

    const secondResponse = await createTestApp()
      .post('/api/crm/contacts')
      .set(authHeader(tenantB))
      .send({
        name: 'Contato Tenant B',
        email: sharedEmail,
        phone: uniquePhone(902),
        document: uniqueDocument(902),
      });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(firstResponse.body.data.email).toBe(sharedEmail);
    expect(secondResponse.body.data.email).toBe(sharedEmail);
  });

  it('PATCH /api/crm/contacts/:id/lgpd/consent atualiza consentimento e cria trilha LGPD', async () => {
    const tenant = requireSuiteTenant();
    const contact = await createContact({
      name: 'Contato Consentimento',
      email: uniqueEmail('lgpd.consent'),
      phone: uniquePhone(903),
      document: uniqueDocument(903),
    });

    const response = await createTestApp()
      .patch(`/api/crm/contacts/${contact.id}/lgpd/consent`)
      .set(authHeader())
      .send({
        status: 'granted',
        source: 'whatsapp_opt_in',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.contact).toMatchObject({
      id: contact.id,
      lgpd_consent_status: 'granted',
      lgpd_consent_source: 'whatsapp_opt_in',
    });
    expect(response.body.data.contact.lgpd_consent_at).toEqual(expect.any(String));
    expect(response.body.data.request).toMatchObject({
      request_type: 'consent_update',
      status: 'processed',
      contact_id: contact.id,
    });

    const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total
       FROM "${tenant.schemaName}".lgpd_requests
       WHERE contact_id = $1::uuid
         AND request_type = 'consent_update'`,
      contact.id,
    );
    expect(Number(rows[0]?.total ?? 0)).toBe(1);
  });

  it('GET /api/crm/contacts/:id/lgpd/export retorna pacote de dados do titular', async () => {
    const tenant = requireSuiteTenant();
    const contact = await createContact({
      name: 'Contato Exportacao',
      email: uniqueEmail('lgpd.export'),
      phone: uniquePhone(904),
      document: uniqueDocument(904),
    });
    const conversationId = randomUUID();
    const ticketId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".conversations
         (id, contact_id, channel_type, protocol_number, status, subject, last_message, last_message_at)
       VALUES ($1::uuid, $2::uuid, 'whatsapp', $3, 'open', 'Solicitação de dados', 'Mensagem inicial', NOW())`,
      conversationId,
      contact.id,
      uniqueProtocol(),
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".messages
         (conversation_id, sender_type, content, content_type, status)
       VALUES ($1::uuid, 'client', 'Preciso dos meus dados', 'text', 'sent')`,
      conversationId,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".tickets
         (id, contact_id, title, status, priority)
       VALUES ($1::uuid, $2::uuid, $3, 'open', 'medium')`,
      ticketId,
      contact.id,
      uniqueText('Ticket LGPD'),
    );

    const response = await createTestApp()
      .get(`/api/crm/contacts/${contact.id}/lgpd/export`)
      .query({ include_messages: true })
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.contact).toMatchObject({ id: contact.id });
    expect(response.body.data.generated_at).toEqual(expect.any(String));
    expect(response.body.data.request_id).toEqual(expect.any(String));
    expect(response.body.data.conversations).toHaveLength(1);
    expect(response.body.data.messages).toHaveLength(1);
    expect(response.body.data.tickets).toHaveLength(1);

    const rows = await prisma.$queryRawUnsafe<Array<{ lgpd_last_export_at: Date | null }>>(
      `SELECT lgpd_last_export_at
       FROM "${tenant.schemaName}".contacts
       WHERE id = $1::uuid`,
      contact.id,
    );
    expect(rows[0]?.lgpd_last_export_at).toBeInstanceOf(Date);
  });

  it('POST /api/crm/contacts/:id/lgpd/anonymize anonimiza contato e mascara mensagens do cliente', async () => {
    const tenant = requireSuiteTenant();
    const contact = await createContact({
      name: 'Contato Anonimizar',
      email: uniqueEmail('lgpd.anon'),
      phone: uniquePhone(905),
      document: uniqueDocument(905),
    });
    const conversationId = randomUUID();
    const callId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".conversations
         (id, contact_id, channel_type, protocol_number, status, subject, last_message, last_message_at)
       VALUES ($1::uuid, $2::uuid, 'whatsapp', $3, 'open', 'Dados sensíveis', 'Meu CPF é 123', NOW())`,
      conversationId,
      contact.id,
      uniqueProtocol(),
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".messages
         (conversation_id, sender_type, content, content_type, status)
       VALUES
         ($1::uuid, 'client', 'Meu CPF é 123', 'text', 'sent'),
         ($1::uuid, 'agent', 'Recebido', 'text', 'sent')`,
      conversationId,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".call_records
         (id, conversation_id, call_sid, to_phone, from_phone, status)
       VALUES ($1::uuid, $2::uuid, $3, '+5511991111111', '+5511992222222', 'completed')`,
      callId,
      conversationId,
      `CA${Date.now()}${Math.floor(Math.random() * 1000)}`,
    );

    const response = await createTestApp()
      .post(`/api/crm/contacts/${contact.id}/lgpd/anonymize`)
      .set(authHeader())
      .send({
        reason: 'Solicitação do titular',
        redact_messages: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.contact).toMatchObject({
      id: contact.id,
      email: null,
      phone: null,
      whatsapp: null,
      document: null,
      lgpd_consent_status: 'revoked',
    });
    expect(response.body.data.contact.name).toContain('Titular anonimizado');
    expect(response.body.data.contact.lgpd_anonymized_at).toEqual(expect.any(String));
    expect(response.body.data.summary).toMatchObject({
      conversations_updated: 1,
      messages_redacted: 1,
    });

    const messageRows = await prisma.$queryRawUnsafe<Array<{ sender_type: string; content: string | null }>>(
      `SELECT sender_type, content
       FROM "${tenant.schemaName}".messages
       WHERE conversation_id = $1::uuid
       ORDER BY sender_type ASC`,
      conversationId,
    );
    const agentMessage = messageRows.find((row) => row.sender_type === 'agent');
    const clientMessage = messageRows.find((row) => row.sender_type === 'client');

    expect(clientMessage?.content).toBe('[mensagem anonimizada por LGPD]');
    expect(agentMessage?.content).toBe('Recebido');

    const callRows = await prisma.$queryRawUnsafe<Array<{ to_phone: string | null; from_phone: string | null }>>(
      `SELECT to_phone, from_phone
       FROM "${tenant.schemaName}".call_records
       WHERE id = $1::uuid`,
      callId,
    );
    expect(callRows[0]).toMatchObject({ to_phone: null, from_phone: null });
  });
});
