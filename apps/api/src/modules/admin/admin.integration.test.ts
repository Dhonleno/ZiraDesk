import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../config/database.js';
import { createIsolatedTestServer, createTestApp, createTestJWT } from '../../test/setup.js';
import { decryptCredentials } from '../../utils/crypto.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';
import { getTenantByTwilioNumber } from './voice-config/voice-config.service.js';

type TenantRole = 'owner' | 'admin' | 'agent' | 'viewer';

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: TenantRole;
}

interface TempTenant {
  id: string;
  slug: string;
  schemaName: string;
  owner: TenantUser;
}

interface ChannelSeed {
  id: string;
  type: 'whatsapp' | 'instagram' | 'email' | 'webchat';
  name: string;
}

const tempTenants: TempTenant[] = [];
let suitePlanId: string | null = null;

function uniqueToken(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
}

function uniquePhoneNumber(): string {
  return `+1555${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
}

function requireSuitePlanId(): string {
  if (!suitePlanId) {
    throw new Error('Plano da suite admin não inicializado');
  }

  return suitePlanId;
}

function authHeader(tenant: TempTenant, actor: TenantUser = tenant.owner): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

async function ensureTenantUser(tenant: TempTenant, user: TenantUser): Promise<TenantUser> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tenant.schemaName}".users
       (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, $2, $3, $4, $5, 'active', 'pt-BR', '{}'::jsonb)
     ON CONFLICT (id)
     DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       role = EXCLUDED.role,
       status = 'active',
       language = 'pt-BR',
       settings = '{}'::jsonb`,
    user.id,
    user.name,
    user.email,
    'not_used_in_jwt_tests',
    user.role,
  );

  if (user.role !== 'viewer') {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".agent_assignments (user_id)
       VALUES ($1::uuid)
       ON CONFLICT (user_id) DO NOTHING`,
      user.id,
    );
  }

  return user;
}

async function createTempTenant(label: string): Promise<TempTenant> {
  const token = uniqueToken();
  const slugLabel = label.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tenant';
  const schemaLabel = label.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tenant';
  const slug = `admin-${slugLabel}-${token}`;
  const schemaName = `test_admin_${schemaLabel}_${token}`;
  const owner: TenantUser = {
    id: randomUUID(),
    name: `Owner ${label.toUpperCase()}`,
    email: `owner.${label}.${token}@ziradesk.test`,
    role: 'owner',
  };

  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant Admin ${label.toUpperCase()} ${token}`,
      slug,
      schemaName,
      planId: requireSuitePlanId(),
      status: 'active',
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, slug: true, schemaName: true },
  });

  try {
    await provisionTenantSchema(schemaName);
    const tempTenant = { ...tenant, owner };
    await ensureTenantUser(tempTenant, owner);
    tempTenants.push(tempTenant);
    return tempTenant;
  } catch (error) {
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
    throw error;
  }
}

async function cleanupTempTenant(tenant: TempTenant): Promise<void> {
  await prisma.subscription.deleteMany({ where: { tenantId: tenant.id } }).catch(() => undefined);
  await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
}

async function createTenantUser(tenant: TempTenant, input: {
  name: string;
  email: string;
  role: TenantRole;
}): Promise<TenantUser> {
  const user: TenantUser = {
    id: randomUUID(),
    name: input.name,
    email: input.email,
    role: input.role,
  };

  return ensureTenantUser(tenant, user);
}

async function insertChannel(tenant: TempTenant, input: {
  type: ChannelSeed['type'];
  name: string;
  credentials?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}): Promise<ChannelSeed> {
  const channel = {
    id: randomUUID(),
    type: input.type,
    name: input.name,
  } satisfies ChannelSeed;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tenant.schemaName}".channels
       (id, type, name, credentials, status, settings)
     VALUES ($1::uuid, $2, $3, $4::jsonb, 'active', $5::jsonb)`,
    channel.id,
    channel.type,
    channel.name,
    JSON.stringify(input.credentials ?? {}),
    JSON.stringify(input.settings ?? {}),
  );

  return channel;
}

async function getStoredSmtpRow(schemaName: string): Promise<{
  password: string;
  last_test_ok: boolean | null;
  last_tested_at: Date | null;
}> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    password: string;
    last_test_ok: boolean | null;
    last_tested_at: Date | null;
  }>>(
    `SELECT password, last_test_ok, last_tested_at
       FROM "${schemaName}".smtp_configs
      ORDER BY created_at DESC
      LIMIT 1`,
  );

  if (!rows[0]) {
    throw new Error(`Nenhuma configuração SMTP encontrada para ${schemaName}`);
  }

  return rows[0];
}

beforeAll(async () => {
  const token = uniqueToken();
  const plan = await prisma.plan.create({
    data: {
      name: `Plano Admin Integration ${token}`,
      slug: `admin-integration-plan-${token}`,
      priceMonth: new Prisma.Decimal('49.90'),
      priceYear: new Prisma.Decimal('499.00'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: {},
    },
    select: { id: true },
  });

  suitePlanId = plan.id;
});

afterEach(async () => {
  while (tempTenants.length > 0) {
    await cleanupTempTenant(tempTenants.pop()!);
  }
});

afterAll(async () => {
  while (tempTenants.length > 0) {
    await cleanupTempTenant(tempTenants.pop()!);
  }

  if (suitePlanId) {
    await prisma.plan.deleteMany({ where: { id: suitePlanId } }).catch(() => undefined);
    suitePlanId = null;
  }
});

describe('Admin integration', () => {
  it('GET /api/admin/users lista usuários apenas do tenant autenticado', async () => {
    const tenantA = await createTempTenant('a');
    const tenantB = await createTempTenant('b');
    const memberA = await createTenantUser(tenantA, {
      name: 'Tenant A Agent',
      email: `tenant.a.agent.${uniqueToken()}@ziradesk.test`,
      role: 'agent',
    });
    const memberB = await createTenantUser(tenantB, {
      name: 'Tenant B Agent',
      email: `tenant.b.agent.${uniqueToken()}@ziradesk.test`,
      role: 'agent',
    });

    const response = await createTestApp()
      .get('/api/admin/users?page=1&per_page=20')
      .set(authHeader(tenantA));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.meta).toMatchObject({ total: 2, page: 1, per_page: 20 });

    const userIds = response.body.data.map((user: { id: string }) => user.id);
    expect(userIds).toContain(tenantA.owner.id);
    expect(userIds).toContain(memberA.id);
    expect(userIds).not.toContain(memberB.id);
  });

  it('POST /api/admin/users/invite convida usuário no tenant', async () => {
    const tenantA = await createTempTenant('invite');
    const invitedEmail = `invited.${uniqueToken()}@ziradesk.test`;

    vi.resetModules();
    vi.doMock('../../services/email.service.js', () => ({
      hasTenantEmailProvider: vi.fn(async () => true),
      sendEmail: vi.fn(async () => undefined),
    }));

    const { createIsolatedTestServer } = await import('../../test/setup.js');
    const localApp = await createIsolatedTestServer();

    try {
      const response = await request(localApp.server)
        .post('/api/admin/users/invite')
        .set(authHeader(tenantA))
        .send({
          name: 'Invited User',
          email: invitedEmail,
          role: 'agent',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toMatchObject({
        name: 'Invited User',
        email: invitedEmail,
        role: 'agent',
        status: 'active',
      });

      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; role: string; status: string }>>(
        `SELECT id, role, status
           FROM "${tenantA.schemaName}".users
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1`,
        invitedEmail,
      );

      expect(rows[0]).toMatchObject({ role: 'agent', status: 'active' });
    } finally {
      await localApp.close().catch(() => undefined);
      vi.doUnmock('../../services/email.service.js');
      vi.resetModules();
    }
  });

  it('PATCH /api/admin/users/:id atualiza role', async () => {
    const tenantA = await createTempTenant('update-user');
    const targetUser = await createTenantUser(tenantA, {
      name: 'Role Target',
      email: `role.target.${uniqueToken()}@ziradesk.test`,
      role: 'agent',
    });

    const response = await createTestApp()
      .patch(`/api/admin/users/${targetUser.id}`)
      .set(authHeader(tenantA))
      .send({ role: 'admin' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      id: targetUser.id,
      role: 'admin',
    });

    const rows = await prisma.$queryRawUnsafe<Array<{ role: string }>>(
      `SELECT role
         FROM "${tenantA.schemaName}".users
        WHERE id = $1::uuid
        LIMIT 1`,
      targetUser.id,
    );

    expect(rows[0]).toMatchObject({ role: 'admin' });
  });

  it('GET /api/admin/channels lista canais do tenant', async () => {
    const tenantA = await createTempTenant('channels-a');
    const tenantB = await createTempTenant('channels-b');
    const channelA = await insertChannel(tenantA, {
      type: 'webchat',
      name: 'Canal Tenant A',
      settings: { theme: 'ocean' },
    });
    const channelB = await insertChannel(tenantB, {
      type: 'whatsapp',
      name: 'Canal Tenant B',
      credentials: { accessToken: 'secret-b' },
    });

    const response = await createTestApp()
      .get('/api/admin/channels')
      .set(authHeader(tenantA));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: channelA.id,
        name: channelA.name,
        type: channelA.type,
      }),
    ]);

    const responseIds = response.body.data.map((channel: { id: string }) => channel.id);
    expect(responseIds).not.toContain(channelB.id);
  });

  it('PATCH /api/admin/voice-config salva e permite lookup público pelo número Twilio', async () => {
    const tenant = await createTempTenant('voice-config');
    const phoneNumber = uniquePhoneNumber();
    const botMenus = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "${tenant.schemaName}".bot_menus ORDER BY created_at ASC LIMIT 1`,
    );
    const botMenuId = botMenus[0]?.id;
    expect(botMenuId).toBeTruthy();

    const response = await createTestApp()
      .patch('/api/admin/voice-config')
      .set(authHeader(tenant))
      .send({
        twilioPhoneNumber: phoneNumber,
        defaultBotMenuId: botMenuId,
        ivrEnabled: true,
        ringTimeoutSeconds: 25,
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      tenantId: tenant.id,
      twilioPhoneNumber: phoneNumber,
      defaultBotMenuId: botMenuId,
      ivrEnabled: true,
      ringTimeoutSeconds: 25,
    });

    const lookup = await getTenantByTwilioNumber(phoneNumber);
    expect(lookup).toMatchObject({
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
      config: {
        twilioPhoneNumber: phoneNumber,
        defaultBotMenuId: botMenuId,
      },
    });
  });

  it('PATCH /api/admin/voice-config rejeita menu de outro tenant e número duplicado', async () => {
    const tenantA = await createTempTenant('voice-config-a');
    const tenantB = await createTempTenant('voice-config-b');
    const phoneNumber = uniquePhoneNumber();
    const tenantBMenus = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "${tenantB.schemaName}".bot_menus ORDER BY created_at ASC LIMIT 1`,
    );

    const invalidMenuResponse = await createTestApp()
      .patch('/api/admin/voice-config')
      .set(authHeader(tenantA))
      .send({
        twilioPhoneNumber: phoneNumber,
        defaultBotMenuId: tenantBMenus[0]?.id,
      });

    expect(invalidMenuResponse.status).toBe(400);
    expect(invalidMenuResponse.body.error).toMatchObject({ code: 'INVALID_BOT_MENU' });

    const firstSave = await createTestApp()
      .patch('/api/admin/voice-config')
      .set(authHeader(tenantA))
      .send({ twilioPhoneNumber: phoneNumber });
    expect(firstSave.status).toBe(200);

    const duplicateResponse = await createTestApp()
      .patch('/api/admin/voice-config')
      .set(authHeader(tenantB))
      .send({ twilioPhoneNumber: phoneNumber });

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.error).toMatchObject({
      code: 'DUPLICATE_TWILIO_PHONE_NUMBER',
    });
  });

  it('POST /api/admin/channels valida e configura o webhook do WhatsApp', async () => {
    const tenantA = await createTempTenant('channels-whatsapp');
    const originalFetch = globalThis.fetch;
    const phoneNumberId = '1176005248926381';
    const wabaId = '1922786558561358';
    const accessToken = 'tenant-whatsapp-token';
    const appId = '792394403295356';
    const appSecret = 'tenant-meta-app-secret';
    const callbackUrl = 'http://localhost:3334/api/webhooks/whatsapp';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/debug_token?')) {
        return new Response(JSON.stringify({ data: { app_id: appId, is_valid: true } }), {
          status: 200,
        });
      }
      if (url.endsWith(`/${appId}/subscriptions`) && init?.method === 'POST') {
        expect(init.headers).toMatchObject({
          Authorization: `Bearer ${appId}|${appSecret}`,
        });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.endsWith(`/${wabaId}?fields=id`)) {
        return new Response(JSON.stringify({ id: wabaId }), { status: 200 });
      }
      if (url.includes(`/${wabaId}/phone_numbers?`)) {
        return new Response(JSON.stringify({ data: [{ id: phoneNumberId }] }), { status: 200 });
      }
      if (url.endsWith(`/${wabaId}/subscribed_apps`) && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.endsWith(`/${phoneNumberId}`) && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes(`/${phoneNumberId}?fields=id,webhook_configuration`)) {
        return new Response(JSON.stringify({
          id: phoneNumberId,
          webhook_configuration: { application: callbackUrl },
        }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: { message: `Unexpected Meta request: ${url}` } }), {
        status: 500,
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const localApp = await createIsolatedTestServer();

    try {
      const response = await request(localApp.server)
        .post('/api/admin/channels')
        .set(authHeader(tenantA))
        .send({
          type: 'whatsapp',
          name: 'WhatsApp Produção',
          credentials: { phoneNumberId, wabaId, appId, appSecret, accessToken },
        });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/${wabaId}/subscribed_apps`),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/${phoneNumberId}`),
        expect.objectContaining({ method: 'POST' }),
      );

      const stored = await prisma.$queryRawUnsafe<Array<{ credentials: string | object }>>(
        `SELECT credentials
           FROM "${tenantA.schemaName}".channels
          WHERE id = $1::uuid`,
        response.body.data.id,
      );
      expect(decryptCredentials(stored[0]!.credentials)).toMatchObject({
        phoneNumberId,
        wabaId,
        appId,
        appSecret,
        accessToken,
      });

      const detailResponse = await request(localApp.server)
        .get(`/api/admin/channels/${response.body.data.id}`)
        .set(authHeader(tenantA));
      expect(detailResponse.status).toBe(200);
      expect(detailResponse.body.data.credentials).toMatchObject({
        phoneNumberId,
        wabaId,
        appId,
        hasAccessToken: true,
        hasAppSecret: true,
      });
      expect(detailResponse.body.data.credentials).not.toHaveProperty('accessToken');
      expect(detailResponse.body.data.credentials).not.toHaveProperty('appSecret');
    } finally {
      await localApp.close();
      globalThis.fetch = originalFetch;
    }
  });

  it('POST /api/admin/channels rejeita WABA ID inválido sem persistir o canal', async () => {
    const tenantA = await createTempTenant('channels-invalid-waba');

    const response = await createTestApp()
      .post('/api/admin/channels')
      .set(authHeader(tenantA))
      .send({
        type: 'whatsapp',
        name: 'WhatsApp Inválido',
        credentials: {
          phoneNumberId: '1176005248926381',
          wabaId: 'not-a-waba-id',
          appId: '792394403295356',
          appSecret: 'tenant-meta-app-secret',
          accessToken: 'tenant-whatsapp-token',
        },
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'CHANNEL_CONFIGURATION_FAILED',
        message: 'WABA ID deve conter apenas números',
      },
    });

    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM "${tenantA.schemaName}".channels
        WHERE name = 'WhatsApp Inválido'`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('POST /api/admin/smtp salva config SMTP com credenciais criptografadas', async () => {
    const tenantA = await createTempTenant('smtp-save');
    const smtpPassword = 'SuperSecret#123';

    const response = await createTestApp()
      .post('/api/admin/smtp')
      .set(authHeader(tenantA))
      .send({
        host: 'smtp.tenant-a.test',
        port: 587,
        secure: false,
        username: 'smtp-user-a',
        password: smtpPassword,
        fromEmail: 'no-reply@tenant-a.test',
        fromName: 'Tenant A',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      host: 'smtp.tenant-a.test',
      port: 587,
      secure: false,
      username: 'smtp-user-a',
      fromEmail: 'no-reply@tenant-a.test',
      fromName: 'Tenant A',
      hasPassword: true,
      isActive: true,
    });
    expect(response.body.data.password).toBeUndefined();

    const smtpRow = await getStoredSmtpRow(tenantA.schemaName);

    expect(smtpRow.password).not.toBe(smtpPassword);
    expect(decryptCredentials(smtpRow.password)).toMatchObject({ password: smtpPassword });
  });

  it('POST /api/admin/smtp/test testa conexão SMTP com nodemailer mockado', async () => {
    const tenantA = await createTempTenant('smtp-test');
    const verifyMock = vi.fn(async () => undefined);
    const sendMailMock = vi.fn(async () => ({ messageId: 'smtp-test-message' }));
    const createTransportMock = vi.fn(() => ({
      verify: verifyMock,
      sendMail: sendMailMock,
    }));

    vi.resetModules();
    vi.doMock('nodemailer', () => ({
      default: {
        createTransport: createTransportMock,
      },
    }));

    const { createIsolatedTestServer } = await import('../../test/setup.js');
    const localApp = await createIsolatedTestServer();

    try {
      const localClient = request(localApp.server);

      const saveResponse = await localClient
        .post('/api/admin/smtp')
        .set(authHeader(tenantA))
        .send({
          host: 'smtp.mocked.test',
          port: 465,
          secure: true,
          username: 'smtp-mocked-user',
          password: 'MockedSecret#456',
          fromEmail: 'no-reply@mocked.test',
          fromName: 'Mocked Tenant',
        });

      expect(saveResponse.status).toBe(201);

      const testResponse = await localClient
        .post('/api/admin/smtp/test')
        .set(authHeader(tenantA))
        .send({});

      expect(testResponse.status).toBe(200);
      expect(testResponse.body).toMatchObject({
        success: true,
        message: 'SMTP configurado corretamente',
      });
      expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({
        host: 'smtp.mocked.test',
        port: 465,
        secure: true,
        auth: {
          user: 'smtp-mocked-user',
          pass: 'MockedSecret#456',
        },
      }));
      expect(verifyMock).toHaveBeenCalledTimes(1);
      expect(sendMailMock).toHaveBeenCalledTimes(1);

      const smtpRow = await getStoredSmtpRow(tenantA.schemaName);
      expect(smtpRow.last_test_ok).toBe(true);
      expect(smtpRow.last_tested_at).toBeTruthy();
    } finally {
      await localApp.close().catch(() => undefined);
      vi.doUnmock('nodemailer');
      vi.resetModules();
    }
  });

  it('Admin do tenant A não consegue listar usuários do tenant B', async () => {
    const tenantA = await createTempTenant('isolamento-a');
    const tenantB = await createTempTenant('isolamento-b');
    const memberB = await createTenantUser(tenantB, {
      name: 'Tenant B Hidden User',
      email: `tenant.b.hidden.${uniqueToken()}@ziradesk.test`,
      role: 'agent',
    });

    const response = await createTestApp()
      .get('/api/admin/users?page=1&per_page=20')
      .set(authHeader(tenantA));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.meta).toMatchObject({ total: 1 });

    const userIds = response.body.data.map((user: { id: string }) => user.id);
    expect(userIds).toEqual([tenantA.owner.id]);
    expect(userIds).not.toContain(memberB.id);
  });
});
