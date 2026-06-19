import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../config/database.js';
import { createSocketServer, getSocketServer } from '../../socket/index.js';
import { createIsolatedTestServer, createTestApp, createTestJWT } from '../../test/setup.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

const USER_ID = '00000000-0000-0000-0000-000000000421';
const AGENT_ID = '00000000-0000-0000-0000-000000000422';

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

async function createTempTenant(): Promise<TempTenant> {
  const suffix = uniqueSuffix();
  const slug = `monitor-bot-${suffix.replace(/_/g, '-')}`;
  const schemaName = `monitor_bot_${suffix}`.toLowerCase();
  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: {
      name: 'Plano Teste',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true },
    },
    create: {
      name: 'Plano Teste',
      slug: 'test-plan',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true },
    },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant Monitor Bot ${suffix}`,
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
     VALUES
       ($1::uuid, 'Supervisor Bot', 'supervisor.bot@ziradesk.test', 'hash', 'admin', 'active', 'pt-BR', '{}'),
       ($2::uuid, 'Agent Bot', 'agent.bot@ziradesk.test', 'hash', 'agent', 'active', 'pt-BR', '{}')`,
    USER_ID,
    AGENT_ID,
  );

  return tenant;
}

function authHeader(tenant: TempTenant): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: USER_ID,
      email: 'supervisor.bot@ziradesk.test',
      name: 'Supervisor Bot',
      role: 'admin',
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

async function createContact(schemaName: string, name: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".contacts (id, name, phone, whatsapp)
     VALUES (gen_random_uuid(), $1, '5511999990000', '5511999990000')
     RETURNING id`,
    name,
  );
  return rows[0]!.id;
}

async function createChannel(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".channels (id, name, type, status, credentials)
     VALUES (gen_random_uuid(), 'Canal Bot', 'whatsapp', 'active', '{}'::jsonb)
     RETURNING id`,
  );
  return rows[0]!.id;
}

async function createConversation(
  schemaName: string,
  channelId: string,
  overrides: {
    status?: 'open' | 'waiting' | 'closed';
    assignedTo?: string | null;
    queueEnteredAt?: Date | null;
    botStage?: string | null;
    createdAt?: Date;
    contactName?: string;
  } = {},
): Promise<string> {
  const contactId = await createContact(schemaName, overrides.contactName ?? 'Contato Bot');
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".conversations
       (id, contact_id, channel_id, channel_type, conversation_type, status, assigned_to, queue_entered_at,
        metadata, created_at, last_message, last_message_at)
     VALUES (
       gen_random_uuid(),
       $1::uuid,
       $2::uuid,
       'whatsapp',
       'inbound',
       $3::"${schemaName}".conversation_status,
       $4::uuid,
       $5::timestamptz,
       $6::jsonb,
       $7::timestamptz,
       'Opção inválida',
       $7::timestamptz
     )
     RETURNING id`,
    contactId,
    channelId,
    overrides.status ?? 'open',
    overrides.assignedTo ?? null,
    overrides.queueEnteredAt?.toISOString() ?? null,
    JSON.stringify(overrides.botStage === null ? {} : { bot_stage: overrides.botStage ?? 'waiting_choice' }),
    (overrides.createdAt ?? new Date(Date.now() - 12 * 60_000)).toISOString(),
  );
  return rows[0]!.id;
}

async function getConversationState(schemaName: string, id: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    status: string;
    queue_entered_at: Date | null;
    metadata: unknown;
    closure_reason: unknown;
  }>>(
    `SELECT status::text AS status, queue_entered_at, metadata, closure_reason
     FROM "${schemaName}".conversations
     WHERE id = $1::uuid`,
    id,
  );
  return rows[0] ?? null;
}

async function countSystemMessages(schemaName: string, conversationId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count
     FROM "${schemaName}".messages
     WHERE conversation_id = $1::uuid
       AND sender_type = 'system'`,
    conversationId,
  );
  return Number(rows[0]?.count ?? 0);
}

async function getAuditCount(schemaName: string, action: string, conversationId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count
     FROM "${schemaName}".audit_logs
     WHERE action = $1
       AND entity_id = $2::uuid`,
    action,
    conversationId,
  );
  return Number(rows[0]?.count ?? 0);
}

describe('Monitor Bot integration', () => {
  let tenant: TempTenant;
  let channelId: string;

  beforeAll(async () => {
    tenant = await createTempTenant();
    channelId = await createChannel(tenant.schemaName);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE "${tenant.schemaName}".messages,
                "${tenant.schemaName}".audit_logs,
                "${tenant.schemaName}".conversations,
                "${tenant.schemaName}".contacts
       RESTART IDENTITY CASCADE`,
    );
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
  });

  it('GET /monitor/bot retorna apenas conversas no bot sem queue_entered_at', async () => {
    const botId = await createConversation(tenant.schemaName, channelId, { contactName: 'Cliente no Bot' });
    await createConversation(tenant.schemaName, channelId, { queueEnteredAt: new Date(), contactName: 'Cliente na Fila' });

    const response = await createTestApp()
      .get('/api/omnichannel/monitor/bot')
      .set(authHeader(tenant));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.stuck).toBe(1);
    expect(response.body.data.conversations).toEqual([
      expect.objectContaining({ id: botId, contact_name: 'Cliente no Bot' }),
    ]);
  });

  it('GET /monitor/bot NÃO inclui conversa com agente atribuído', async () => {
    await createConversation(tenant.schemaName, channelId, { assignedTo: AGENT_ID });

    const response = await createTestApp()
      .get('/api/omnichannel/monitor/bot')
      .set(authHeader(tenant));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
  });

  it('GET /monitor/bot NÃO inclui conversa com status diferente de open', async () => {
    await createConversation(tenant.schemaName, channelId, { status: 'waiting' });

    const response = await createTestApp()
      .get('/api/omnichannel/monitor/bot')
      .set(authHeader(tenant));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
  });

  it('POST /monitor/bot/:id/pull seta fila, cria mensagem, emite socket e cria audit_log', async () => {
    const conversationId = await createConversation(tenant.schemaName, channelId);
    const app = await createIsolatedTestServer();
    createSocketServer(app.server);
    const io = getSocketServer();
    const emit = vi.fn();
    vi.spyOn(io, 'to').mockReturnValue({ emit } as never);

    const response = await app.inject({
      method: 'POST',
      url: `/api/omnichannel/monitor/bot/${conversationId}/pull`,
      headers: authHeader(tenant),
      payload: {},
    });
    await app.close();

    const state = await getConversationState(tenant.schemaName, conversationId);
    const metadata = state?.metadata as Record<string, unknown>;
    expect(response.statusCode).toBe(200);
    expect(state?.queue_entered_at).toBeInstanceOf(Date);
    expect(metadata['bot_stage']).toBe('transferred');
    expect(await countSystemMessages(tenant.schemaName, conversationId)).toBe(1);
    expect(await getAuditCount(tenant.schemaName, 'conversation.bot.pulled', conversationId)).toBe(1);
    expect(emit).toHaveBeenCalledWith('conversation:updated', expect.objectContaining({
      conversationId,
      status: 'open',
      assigned_to: null,
    }));
  });

  it('POST /monitor/bot/:id/pull em conversa que não está no bot retorna 422', async () => {
    const conversationId = await createConversation(tenant.schemaName, channelId, {
      queueEnteredAt: new Date(),
    });

    const response = await createTestApp()
      .post(`/api/omnichannel/monitor/bot/${conversationId}/pull`)
      .set(authHeader(tenant))
      .send({});

    expect(response.status).toBe(422);
  });

  it('POST /monitor/bot/:id/close seta status closed e cria audit_log', async () => {
    const conversationId = await createConversation(tenant.schemaName, channelId);
    const app = await createIsolatedTestServer();
    createSocketServer(app.server);
    const io = getSocketServer();
    const emit = vi.fn();
    vi.spyOn(io, 'to').mockReturnValue({ emit } as never);

    const response = await app.inject({
      method: 'POST',
      url: `/api/omnichannel/monitor/bot/${conversationId}/close`,
      headers: authHeader(tenant),
      payload: { message: 'Atendimento encerrado.' },
    });
    await app.close();

    const state = await getConversationState(tenant.schemaName, conversationId);
    const reason = state?.closure_reason as Record<string, unknown>;
    expect(response.statusCode).toBe(200);
    expect(state?.status).toBe('closed');
    expect(reason['reason']).toBe('bot_stuck');
    expect(await countSystemMessages(tenant.schemaName, conversationId)).toBe(1);
    expect(await getAuditCount(tenant.schemaName, 'conversation.bot.closed', conversationId)).toBe(1);
    expect(emit).toHaveBeenCalledWith('conversation:updated', expect.objectContaining({
      conversationId,
      status: 'closed',
    }));
  });

  it('POST /monitor/bot/:id/close em conversa já fechada retorna 409', async () => {
    const conversationId = await createConversation(tenant.schemaName, channelId, { status: 'closed' });

    const response = await createTestApp()
      .post(`/api/omnichannel/monitor/bot/${conversationId}/close`)
      .set(authHeader(tenant))
      .send({});

    expect(response.status).toBe(409);
  });

  it('sem autenticação retorna 401', async () => {
    const response = await createTestApp().get('/api/omnichannel/monitor/bot');
    expect(response.status).toBe(401);
  });

  it('POST /monitor/bot/:id/pull com id inexistente retorna 404', async () => {
    const response = await createTestApp()
      .post(`/api/omnichannel/monitor/bot/${randomUUID()}/pull`)
      .set(authHeader(tenant))
      .send({});

    expect(response.status).toBe(404);
  });
});
