import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../config/database.js';
import { createSocketServer, getSocketServer } from '../../socket/index.js';
import { createIsolatedTestServer, createTestApp, createTestJWT } from '../../test/setup.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

const AGENT_ID = '00000000-0000-0000-0000-000000000211';

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

async function createTempTenant(): Promise<TempTenant> {
  const suffix = uniqueSuffix();
  const slug = `conv-${suffix.replace(/_/g, '-')}`;
  const schemaName = `conv_${suffix}`.toLowerCase();
  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: { name: 'Plano Teste', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: {} },
    create: { name: 'Plano Teste', slug: 'test-plan', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: {} },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant Conversations ${suffix}`,
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
     VALUES ($1::uuid, 'Agent Conversations', 'agent.conv@ziradesk.test', 'hash', 'agent', 'active', 'pt-BR', '{}')`,
    AGENT_ID,
  );
  return tenant;
}

function authHeader(tenant: TempTenant, role: 'agent' | 'viewer' = 'agent'): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: AGENT_ID,
      email: 'agent.conv@ziradesk.test',
      name: 'Agent Conversations',
      role,
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

async function createContact(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".contacts (id, name, email, phone, whatsapp)
     VALUES (gen_random_uuid(), 'Contato Novo Atendimento', 'novo@ziradesk.test', '5511999990000', '5511999990000')
     RETURNING id`,
  );
  return rows[0]!.id;
}

async function createChannel(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".channels (id, name, type, status, credentials)
     VALUES (gen_random_uuid(), 'Canal E-mail Novo Atendimento', 'email', 'active', '{}'::jsonb)
     RETURNING id`,
  );
  return rows[0]!.id;
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

describe('Novo atendimento integration', () => {
  let tenant: TempTenant;

  beforeAll(async () => {
    tenant = await createTempTenant();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
  });

  it('POST /api/omnichannel/conversations cria conversa e retorna 201 com id', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName);

    const response = await createTestApp()
      .post('/api/omnichannel/conversations')
      .set(authHeader(tenant))
      .send({ contact_id: contactId, channel_id: channelId, initial_message: 'Mensagem inicial' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toEqual(expect.any(String));
  });

  it('retorna 404 quando contato não existe', async () => {
    const channelId = await createChannel(tenant.schemaName);
    const response = await createTestApp()
      .post('/api/omnichannel/conversations')
      .set(authHeader(tenant))
      .send({ contact_id: randomUUID(), channel_id: channelId });

    expect(response.status).toBe(404);
  });

  it('retorna 404 quando canal não existe', async () => {
    const contactId = await createContact(tenant.schemaName);
    const response = await createTestApp()
      .post('/api/omnichannel/conversations')
      .set(authHeader(tenant))
      .send({ contact_id: contactId, channel_id: randomUUID() });

    expect(response.status).toBe(404);
  });

  it('retorna 409 com existingId quando já existe conversa open para contato e canal', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName);
    const existingId = await createOpenConversation(tenant.schemaName, contactId, channelId);

    const response = await createTestApp()
      .post('/api/omnichannel/conversations')
      .set(authHeader(tenant))
      .send({ contact_id: contactId, channel_id: channelId });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'DUPLICATE_OPEN_CONVERSATION', existingId });
  });

  it('retorna 403 sem permissão conversations:reply', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName);

    const response = await createTestApp()
      .post('/api/omnichannel/conversations')
      .set(authHeader(tenant, 'viewer'))
      .send({ contact_id: contactId, channel_id: channelId });

    expect(response.status).toBe(403);
  });

  it('cria audit_log após sucesso', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName);

    const response = await createTestApp()
      .post('/api/omnichannel/conversations')
      .set(authHeader(tenant))
      .send({ contact_id: contactId, channel_id: channelId, initial_message: 'Auditoria criada' });

    const rows = await prisma.$queryRawUnsafe<Array<{ action: string; new_data: Record<string, unknown> }>>(
      `SELECT action, new_data
       FROM "${tenant.schemaName}".audit_logs
       WHERE entity_id = $1::uuid AND action = 'conversation.created'
       LIMIT 1`,
      response.body.data.id,
    );

    expect(rows[0]?.action).toBe('conversation.created');
    expect(rows[0]?.new_data).toMatchObject({
      contact_id: contactId,
      channel_id: channelId,
      channel_type: 'email',
      conversation_type: 'inbound',
      initial_message: 'Auditoria criada',
      created_by: AGENT_ID,
    });
  });

  it('emite socket conversation:created', async () => {
    const contactId = await createContact(tenant.schemaName);
    const channelId = await createChannel(tenant.schemaName);
    const app = await createIsolatedTestServer();
    createSocketServer(app.server);
    const emit = vi.fn();
    vi.spyOn(getSocketServer(), 'to').mockReturnValue({ emit } as never);

    await prisma.$executeRawUnsafe(
      `SET search_path TO "${tenant.schemaName}", public`,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/omnichannel/conversations',
      headers: authHeader(tenant),
      payload: { contact_id: contactId, channel_id: channelId },
    });
    const body = JSON.parse(response.body) as { data: { id: string } };

    expect(response.statusCode).toBe(201);
    expect(emit).toHaveBeenCalledWith('conversation:created', expect.objectContaining({
      conversation: expect.objectContaining({ id: body.data.id }),
    }));
    await app.close();
  });
});
