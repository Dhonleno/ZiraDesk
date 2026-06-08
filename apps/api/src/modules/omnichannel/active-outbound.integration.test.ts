import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { ensureTemplatesInfrastructure } from '../admin/templates/templates.service.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

const AGENT_ID = '00000000-0000-0000-0000-000000000212';

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

async function createTempTenant(): Promise<TempTenant> {
  const suffix = uniqueSuffix();
  const slug = `active-outbound-${suffix.replace(/_/g, '-')}`;
  const schemaName = `active_outbound_${suffix}`.toLowerCase();
  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: { name: 'Plano Teste', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: {} },
    create: { name: 'Plano Teste', slug: 'test-plan', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: {} },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant Active Outbound ${suffix}`,
      slug,
      schemaName,
      planId: plan.id,
      status: 'active',
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, schemaName: true },
  });
  await provisionTenantSchema(tenant.schemaName);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tenant.schemaName}".users (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, 'Agent Active Outbound', 'agent.active.outbound@ziradesk.test', 'hash', 'agent', 'active', 'pt-BR', '{}')`,
    AGENT_ID,
  );
  return tenant;
}

function authHeader(tenant: TempTenant, role: 'agent' | 'viewer' = 'agent'): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: AGENT_ID,
      email: 'agent.active.outbound@ziradesk.test',
      name: 'Agent Active Outbound',
      role,
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

async function createContact(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".contacts (id, name, email, phone, whatsapp)
     VALUES (gen_random_uuid(), 'Contato Envio Ativo', 'ativo@ziradesk.test', '5511888880000', '5511888880000')
     RETURNING id`,
  );
  return rows[0]!.id;
}

async function createChannel(schemaName: string, type: 'whatsapp' | 'email'): Promise<string> {
  const credentials = type === 'whatsapp'
    ? { phoneNumberId: 'test-phone', accessToken: 'test-token' }
    : {};
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".channels (id, name, type, status, credentials)
     VALUES (gen_random_uuid(), $1, $2, 'active', $3::jsonb)
     RETURNING id`,
    `Canal ${type}`,
    type,
    JSON.stringify(credentials),
  );
  return rows[0]!.id;
}

async function createTemplate(
  schemaName: string,
  channelId: string,
  status = 'approved',
  name = `template_${uniqueSuffix()}`,
): Promise<string> {
  await ensureTemplatesInfrastructure(schemaName);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".whatsapp_templates
       (channel_id, name, display_name, language, category, body, variables, status, meta_template_id)
     VALUES ($1::uuid, $2, $3, 'pt_BR', 'UTILITY', 'Olá {{1}}, este é um envio ativo.', '["1"]'::jsonb, $4, 'meta-template-id')`,
    channelId,
    name,
    name,
    status,
  );
  return name;
}

async function createOpenConversation(schemaName: string, contactId: string, channelId: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".conversations
       (id, contact_id, channel_id, channel_type, conversation_type, status, assigned_to)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'email', 'inbound', 'open', $3::uuid)
     RETURNING id`,
    contactId,
    channelId,
    AGENT_ID,
  );
  return rows[0]!.id;
}

async function getConversation(schemaName: string, id: string): Promise<{ waiting_expires_at: Date | null; status: string }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ waiting_expires_at: Date | null; status: string }>>(
    `SELECT waiting_expires_at, status
     FROM "${schemaName}".conversations
     WHERE id = $1::uuid
     LIMIT 1`,
    id,
  );
  return rows[0]!;
}

describe('Envio ativo integration', () => {
  let tenant: TempTenant;

  beforeAll(async () => {
    tenant = await createTempTenant();
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
  });

  it('happy path com template cria conversa waiting e retorna 201', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'whatsapp');
    const templateName = await createTemplate(tenant.schemaName, channelId);

    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({
        contactId,
        channelId,
        useTemplate: true,
        templateName,
        templateLanguage: 'pt_BR',
        templateComponents: [{ type: 'body', parameters: [{ type: 'text', text: 'Cliente' }] }],
      });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.body.data.status).toBe('waiting');
  });

  it('happy path sem template cria conversa waiting e retorna 201', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'email');

    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({
        contactId,
        channelId,
        useTemplate: false,
        subject: 'Assunto ativo',
        message: 'Mensagem livre de envio ativo',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('waiting');
  });

  it('retorna 409 em duplicata de conversa aberta', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'email');
    const existingId = await createOpenConversation(tenant.schemaName, contactId, channelId);

    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({ contactId, channelId, useTemplate: false, subject: 'Duplicado', message: 'Duplicado' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'DUPLICATE_OPEN_CONVERSATION', existingId });
  });

  it('retorna 422 quando template não está aprovado', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'whatsapp');
    const templateName = await createTemplate(tenant.schemaName, channelId, 'rejected');

    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({ contactId, channelId, useTemplate: true, templateName, templateLanguage: 'pt_BR' });

    expect(response.status).toBe(422);
  });

  it('calcula waiting_expires_at com settings hours=48', async () => {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: { active_outbound_validity_mode: 'hours', active_outbound_validity_hours: 48 } },
    });
    const before = Date.now();
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'email');

    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({ contactId, channelId, useTemplate: false, subject: '48h', message: 'Validade 48h' });

    const after = Date.now();
    const conversation = await getConversation(tenant.schemaName, response.body.data.id);
    expect(conversation.waiting_expires_at).not.toBeNull();
    const expiresAt = conversation.waiting_expires_at!.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 48 * 60 * 60 * 1000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 48 * 60 * 60 * 1000 + 1000);
  });

  it('calcula waiting_expires_at com settings mode=end_of_day', async () => {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: { active_outbound_validity_mode: 'end_of_day', timezone: 'America/Sao_Paulo' } },
    });
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'email');

    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({ contactId, channelId, useTemplate: false, subject: 'EOD', message: 'Validade fim do dia' });

    const conversation = await getConversation(tenant.schemaName, response.body.data.id);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).format(conversation.waiting_expires_at!);
    expect(parts).toBe('23:59:59');
  });

  it('mantém waiting_expires_at nulo com settings mode=unlimited', async () => {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: { active_outbound_validity_mode: 'unlimited' } },
    });
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'email');

    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({ contactId, channelId, useTemplate: false, subject: 'Sem limite', message: 'Validade ilimitada' });

    expect(response.status).toBe(201);
    const conversation = await getConversation(tenant.schemaName, response.body.data.id);
    expect(conversation.waiting_expires_at).toBeNull();
    expect(conversation.status).toBe('waiting');
  });

  it('cria audit_log após sucesso', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'email');
    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({ contactId, channelId, useTemplate: false, subject: 'Audit', message: 'Mensagem audit outbound' });

    const rows = await prisma.$queryRawUnsafe<Array<{ new_data: Record<string, unknown> }>>(
      `SELECT new_data
       FROM "${tenant.schemaName}".audit_logs
       WHERE action = 'conversation.created'
         AND entity_id = $1::uuid
       LIMIT 1`,
      response.body.data.id,
    );

    expect(rows[0]?.new_data).toMatchObject({
      contact_id: contactId,
      channel_id: channelId,
      channel_type: 'email',
      conversation_type: 'outbound',
      initial_message: 'Mensagem audit outbound',
      created_by: AGENT_ID,
    });
  });

  it('retorna 403 sem permissão conversations:reply', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName, 'email');

    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant, 'viewer'))
      .send({ contactId, channelId, useTemplate: false, subject: 'Sem permissão', message: 'Sem permissão' });

    expect(response.status).toBe(403);
  });

  it('retorna 404 quando contato não existe', async () => {
    const channelId = await createChannel(tenant.schemaName, 'email');
    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader(tenant))
      .send({ contactId: randomUUID(), channelId, useTemplate: false, subject: 'Contato', message: 'Contato' });

    expect(response.status).toBe(404);
  });
});
