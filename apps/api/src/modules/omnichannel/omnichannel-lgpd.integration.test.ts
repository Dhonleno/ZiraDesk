import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';
import { ensureCrmInfrastructure } from '../crm/crm.infrastructure.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000031';
const TEST_USER_NAME = 'LGPD Omnichannel Test User';
const TEST_USER_EMAIL = 'lgpd.omnichannel@ziradesk.test';

interface TempTenant { id: string; schemaName: string }

let suiteTenant: TempTenant | null = null;

function authHeader(): { Authorization: string } {
  const tenant = suiteTenant!;
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      name: TEST_USER_NAME,
      role: 'owner',
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

async function createTempTenant(): Promise<TempTenant> {
  const suffix = Date.now().toString().slice(-8);
  const slug = `lgpd-oc-${suffix}`;
  const schemaName = `lgpd_oc_${suffix}`;

  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: { name: 'Plano Teste', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true } },
    create: { name: 'Plano Teste', slug: 'test-plan', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true } },
  });

  const tenant = await prisma.tenant.create({
    data: { name: `Tenant ${slug}`, slug, schemaName, planId: plan.id, status: 'active', trialEndsAt: null, settings: {} },
    select: { id: true, schemaName: true },
  });

  await provisionTenantSchema(schemaName);
  await ensureCrmInfrastructure(schemaName);

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".users (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, $2, $3, 'x', 'owner', 'active', 'pt-BR', '{}')
     ON CONFLICT (id) DO UPDATE SET role = 'owner', status = 'active'`,
    TEST_USER_ID, TEST_USER_NAME, TEST_USER_EMAIL,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".agent_assignments (user_id) VALUES ($1::uuid) ON CONFLICT (user_id) DO NOTHING`,
    TEST_USER_ID,
  );

  return { id: tenant.id, schemaName };
}

async function destroyTenant(tenant: TempTenant): Promise<void> {
  await prisma.tenant.deleteMany({ where: { schemaName: tenant.schemaName } });
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`);
}

async function createConversationWithMessages(
  schemaName: string,
  externalId: string,
  messageCount = 3,
  contactId?: string,
): Promise<{ conversationId: string; messageIds: string[] }> {
  const convId = randomUUID();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".conversations
       (id, channel_type, external_id, contact_id, status, last_message, last_message_at)
     VALUES ($1::uuid, 'whatsapp', $2, $3::uuid, 'closed', 'última mensagem', NOW())`,
    convId, externalId, contactId ?? null,
  );

  const messageIds: string[] = [];
  for (let i = 0; i < messageCount; i++) {
    const msgId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".messages
         (id, conversation_id, sender_type, content, content_type, status)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'text', 'sent')`,
      msgId, convId, i % 2 === 0 ? 'client' : 'agent', `Mensagem ${i + 1} com dados pessoais`,
    );
    messageIds.push(msgId);
  }

  return { conversationId: convId, messageIds };
}

async function getConversation(schemaName: string, id: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ external_id: string | null; last_message: string | null }>>(
    `SELECT external_id, last_message FROM "${schemaName}".conversations WHERE id = $1::uuid`,
    id,
  );
  return rows[0] ?? null;
}

async function getMessages(schemaName: string, conversationId: string) {
  return prisma.$queryRawUnsafe<Array<{ id: string; content: string | null; metadata: unknown }>>(
    `SELECT id, content, metadata FROM "${schemaName}".messages WHERE conversation_id = $1::uuid ORDER BY created_at`,
    conversationId,
  );
}

async function getLgpdRequests(schemaName: string, subjectType: string) {
  return prisma.$queryRawUnsafe<Array<{ id: string; subject_type: string; request_type: string; status: string; payload: unknown; result: unknown }>>(
    `SELECT id, subject_type, request_type, status, payload, result FROM "${schemaName}".lgpd_requests WHERE subject_type = $1 ORDER BY requested_at DESC`,
    subjectType,
  );
}

beforeAll(async () => {
  suiteTenant = await createTempTenant();
});

afterAll(async () => {
  if (suiteTenant) await destroyTenant(suiteTenant);
});

beforeEach(async () => {
  const s = suiteTenant!.schemaName;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${s}".messages, "${s}".conversations, "${s}".lgpd_requests RESTART IDENTITY CASCADE`);
});

describe('anonymizeByExternalId', () => {
  it('should hash external_id and redact all message content', async () => {
    const app = createTestApp();
    const externalId = '+5511987654321';
    const { conversationId, messageIds } = await createConversationWithMessages(suiteTenant!.schemaName, externalId, 4);

    const res = await app
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: externalId, reason: 'Solicitação LGPD via teste' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary.conversations_anonymized).toBe(1);
    expect(res.body.data.summary.messages_redacted).toBe(4);

    const conv = await getConversation(suiteTenant!.schemaName, conversationId);
    expect(conv).not.toBeNull();
    expect(conv!.external_id).not.toBe(externalId);
    expect(conv!.external_id).toHaveLength(64);
    expect(conv!.last_message).toBe('[mensagem anonimizada por LGPD]');

    const messages = await getMessages(suiteTenant!.schemaName, conversationId);
    expect(messages).toHaveLength(4);
    for (const msg of messages) {
      expect(msg.content).toBe('[mensagem anonimizada por LGPD]');
      expect((msg.metadata as Record<string, unknown>)?.lgpd_redacted).toBe(true);
    }
    void messageIds;
  });

  it('should produce a deterministic hash (same input = same output)', async () => {
    const schema = suiteTenant!.schemaName;
    const externalId1 = '+5511111111111';
    const externalId2 = '+5522222222222';

    await createConversationWithMessages(schema, externalId1, 1);
    await createConversationWithMessages(schema, externalId2, 1);

    const rows = await prisma.$queryRawUnsafe<Array<{ external_id: string }>>(
      `SELECT encode(sha256($1::bytea), 'hex') AS external_id`,
      externalId1,
    );
    const expectedHash = rows[0]!.external_id;

    await createTestApp()
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: externalId1, reason: 'Teste determinismo' });

    const hash1Rows = await prisma.$queryRawUnsafe<Array<{ h: string }>>(
      `SELECT encode(sha256($1::bytea), 'hex') AS h`,
      externalId1,
    );
    const hash2Rows = await prisma.$queryRawUnsafe<Array<{ h: string }>>(
      `SELECT encode(sha256($2::bytea), 'hex') AS h`,
      externalId1,
      externalId2,
    );

    expect(hash1Rows[0]!.h).toBe(expectedHash);
    expect(hash2Rows[0]!.h).not.toBe(expectedHash);
  });

  it('should return 409 when already anonymized', async () => {
    const externalId = '+5511555555555';
    await createConversationWithMessages(suiteTenant!.schemaName, externalId, 1);

    const app = createTestApp();
    await app
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: externalId, reason: 'Primeiro pedido' });

    const res2 = await app
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: externalId, reason: 'Segundo pedido' });

    expect(res2.status).toBe(409);
  });

  it('should return 404 when external_id not found', async () => {
    const res = await createTestApp()
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: '+5500000000000', reason: 'Teste 404' });

    expect(res.status).toBe(404);
  });

  it('should create lgpd_request audit record', async () => {
    const externalId = '+5511888888888';
    await createConversationWithMessages(suiteTenant!.schemaName, externalId, 2);

    await createTestApp()
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: externalId, reason: 'Teste audit trail' });

    const requests = await getLgpdRequests(suiteTenant!.schemaName, 'external');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.request_type).toBe('external_anonymization');
    expect(requests[0]!.status).toBe('processed');
  });

  it('should not touch conversations linked to a contact', async () => {
    const schema = suiteTenant!.schemaName;
    const externalId = '+5511777777777';

    const contactId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".contacts (id, name) VALUES ($1::uuid, 'Contato Vinculado')`,
      contactId,
    );

    await createConversationWithMessages(schema, externalId, 2, contactId);

    const res = await createTestApp()
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: externalId, reason: 'Não deve afetar' });

    expect(res.status).toBe(404);

    const rows = await prisma.$queryRawUnsafe<Array<{ external_id: string }>>(
      `SELECT external_id FROM "${schema}".conversations WHERE contact_id = $1::uuid`,
      contactId,
    );
    expect(rows[0]!.external_id).toBe(externalId);
  });
});

describe('cascade anonymization via contact (anonymizeContactForLgpd)', () => {
  it('should hash external_id on conversations when contact is anonymized', async () => {
    const schema = suiteTenant!.schemaName;
    const externalId = '+5511666666666';

    const contactId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".contacts (id, name) VALUES ($1::uuid, 'Titular Teste')`,
      contactId,
    );

    const { conversationId } = await createConversationWithMessages(schema, externalId, 2, contactId);

    const app = createTestApp();
    const res = await app
      .post(`/api/crm/contacts/${contactId}/lgpd/anonymize`)
      .set(authHeader())
      .send({ reason: 'Teste cascade', redact_messages: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const conv = await getConversation(schema, conversationId);
    expect(conv!.external_id).not.toBe(externalId);
    expect(conv!.external_id).toHaveLength(64);
    expect(conv!.last_message).toBe('[mensagem anonimizada por LGPD]');
  });

  it('should redact all messages (not just client) when contact is anonymized', async () => {
    const schema = suiteTenant!.schemaName;
    const externalId = '+5511444444444';

    const contactId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".contacts (id, name) VALUES ($1::uuid, 'Titular Agente')`,
      contactId,
    );

    const { conversationId } = await createConversationWithMessages(schema, externalId, 4, contactId);

    await createTestApp()
      .post(`/api/crm/contacts/${contactId}/lgpd/anonymize`)
      .set(authHeader())
      .send({ reason: 'Redação total', redact_messages: true });

    const messages = await getMessages(schema, conversationId);
    expect(messages).toHaveLength(4);
    for (const msg of messages) {
      expect(msg.content).toBe('[mensagem anonimizada por LGPD]');
    }
  });
});

describe('GET /api/admin/omnichannel/conversations/external-requests', () => {
  it('should list external lgpd requests', async () => {
    const schema = suiteTenant!.schemaName;
    const externalId = '+5511333333333';
    await createConversationWithMessages(schema, externalId, 1);

    await createTestApp()
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: externalId, reason: 'Listagem' });

    const res = await createTestApp()
      .get('/api/admin/omnichannel/conversations/external-requests')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].subject_type).toBe('external');
    expect(res.body.data[0].request_type).toBe('external_anonymization');
    expect(res.body.meta.total).toBe(1);
  });

  it('should filter by status', async () => {
    const schema = suiteTenant!.schemaName;
    const externalId = '+5511222222222';
    await createConversationWithMessages(schema, externalId, 1);

    await createTestApp()
      .post('/api/admin/omnichannel/conversations/anonymize-by-external-id')
      .set(authHeader())
      .send({ external_id: externalId, reason: 'Filtro status' });

    const resProcessed = await createTestApp()
      .get('/api/admin/omnichannel/conversations/external-requests?status=processed')
      .set(authHeader());

    expect(resProcessed.body.data).toHaveLength(1);

    const resPending = await createTestApp()
      .get('/api/admin/omnichannel/conversations/external-requests?status=pending')
      .set(authHeader());

    expect(resPending.body.data).toHaveLength(0);
  });
});
