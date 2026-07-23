import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import Fastify, { type FastifyInstance } from 'fastify';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import { Prisma } from '@prisma/client';
import { StorageObjectNotFoundError, type StorageProvider } from '../lib/storage/index.js';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { superAdminRoutes } from '../modules/super-admin/index.js';
import { omnichannelModuleRoutes } from '../modules/omnichannel/index.js';
import { adminRoutes } from '../modules/admin/index.js';
import { crmRoutes } from '../modules/crm/index.js';
import { ticketModuleRoutes } from '../modules/tickets/index.js';
import { webhookRoutes } from '../modules/webhooks/index.js';
import { notificationsRoutes } from '../modules/notifications/notifications.routes.js';
import { searchRoutes } from '../modules/search/search.routes.js';
import { callsRoutes } from '../modules/calls/calls.routes.js';
import { portalModuleRoutes } from '../modules/portal/index.js';
import { legalModuleRoutes } from '../modules/legal/index.js';
import { redmineWebhookRoutes } from '../modules/integrations/redmine/redmine.routes.js';
import { provisionTenantSchema } from '../modules/super-admin/tenants/tenants.service.js';
import { languageMiddleware } from '../middleware/language.js';
import { createSocketServer } from '../socket/index.js';

interface TestTenant {
  id: string;
  slug: string;
  schemaName: string;
}

interface TestUser {
  id: string;
  email: string;
  name: string;
  role: 'owner';
}

interface IntegrationState {
  app: FastifyInstance;
  baseUrl: string;
  tenant: TestTenant;
  user: TestUser;
}

interface JwtOverrides {
  sub?: string;
  email?: string;
  name?: string;
  role?: 'owner' | 'admin' | 'agent' | 'viewer' | 'super_admin';
  tenantId?: string;
  schemaName?: string;
  isSuperAdmin?: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __ZIRADESK_TEST_BASE_URL__: string | undefined;
  // eslint-disable-next-line no-var
  var __ZIRADESK_TEST_TENANT_ID__: string | undefined;
  // eslint-disable-next-line no-var
  var __ZIRADESK_TEST_TENANT_SLUG__: string | undefined;
  // eslint-disable-next-line no-var
  var __ZIRADESK_TEST_TENANT_SCHEMA__: string | undefined;
}

let integrationState: IntegrationState | null = null;
let cleanupStarted = false;

const TEST_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'integration@test.ziradesk.com',
  name: 'Integration Test User',
  password: 'Integration#123',
  role: 'owner' as const,
};

class InMemoryStorageProvider implements StorageProvider {
  private readonly files = new Map<string, { buffer: Buffer; mimetype: string }>();

  async upload(key: string, buffer: Buffer, mimetype: string): Promise<string> {
    this.files.set(key, { buffer: Buffer.from(buffer), mimetype });
    return this.getUrl(key);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  getUrl(key: string): string {
    return `/api/files/${key}`;
  }

  async download(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    if (!file) {
      throw new StorageObjectNotFoundError(key);
    }
    return Buffer.from(file.buffer);
  }
}

globalThis.__ZIRADESK_TEST_STORAGE__ = new InMemoryStorageProvider();

function apiRootDir(): string {
  const current = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(current), '../../');
}

function parseDatabaseUrlSchemaName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return url.searchParams.get('schema') ?? 'public';
}

function validateSchemaName(schemaName: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) {
    throw new Error(`Nome de schema inválido para testes: ${schemaName}`);
  }
  return schemaName;
}

function rateLimitMax(requestUrl: string): number {
  if (requestUrl.startsWith('/api/auth/refresh')) return 60;
  if (requestUrl.startsWith('/api/auth/')) return 10;
  if (requestUrl.startsWith('/api/webhooks/')) return 1000;
  return 200;
}

async function ensurePublicSchemaMigrations(): Promise<void> {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiRootDir(),
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: env.DATABASE_URL,
    },
  });
}

async function ensureTestTenant(schemaName: string, slug: string): Promise<{
  tenant: TestTenant;
  user: TestUser;
}> {
  const safeSchemaName = validateSchemaName(schemaName);

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

  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant ${slug}`,
        slug,
        schemaName: safeSchemaName,
        planId: plan.id,
        status: 'active',
        trialEndsAt: null,
        settings: {},
      },
      select: { id: true, slug: true, schemaName: true },
    });
    tenantId = tenant.id;

    await provisionTenantSchema(safeSchemaName);

    const passwordHash = await bcrypt.hash(TEST_USER.password, 12);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${safeSchemaName}".users
         (id, name, email, password_hash, role, status, language, settings)
       VALUES ($1::uuid, $2, $3, $4, 'owner', 'active', 'pt-BR', '{}'::jsonb)
       ON CONFLICT (id)
       DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         role = 'owner',
         status = 'active',
         language = 'pt-BR',
         settings = '{}'::jsonb`,
      TEST_USER.id,
      TEST_USER.name,
      TEST_USER.email,
      passwordHash,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${safeSchemaName}".agent_assignments (user_id)
       VALUES ($1::uuid)
       ON CONFLICT (user_id) DO NOTHING`,
      TEST_USER.id,
    );

    return {
      tenant,
      user: {
        id: TEST_USER.id,
        email: TEST_USER.email,
        name: TEST_USER.name,
        role: TEST_USER.role,
      },
    };
  } catch (error) {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${safeSchemaName}" CASCADE`).catch(() => undefined);

    if (tenantId) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }

    throw error;
  }
}

export async function createIsolatedTestServer(): Promise<FastifyInstance> {
  const app = Fastify({
    ignoreTrailingSlash: true,
    logger: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  if (process.env.NODE_ENV !== 'test') {
    await app.register(rateLimit, {
      max: (requestLike) => rateLimitMax(requestLike.url),
      timeWindow: '1 minute',
      keyGenerator: (requestLike) => requestLike.headers.authorization ?? requestLike.ip,
      allowList: (requestLike) => requestLike.url === '/health',
    });
  }
  await app.register(cookie, { secret: env.JWT_SECRET });
  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  });

  app.addHook('onRequest', languageMiddleware);

  await app.register(webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(redmineWebhookRoutes, { prefix: '/api' });
  await app.register(legalModuleRoutes, { prefix: '/api/legal' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(superAdminRoutes, { prefix: '/api/super-admin' });
  await app.register(omnichannelModuleRoutes, { prefix: '/api/omnichannel' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(crmRoutes, { prefix: '/api/crm' });
  await app.register(ticketModuleRoutes, { prefix: '/api/tickets' });
  await app.register(portalModuleRoutes, { prefix: '/api/portal' });
  await app.register(notificationsRoutes, { prefix: '/api/notifications' });
  await app.register(searchRoutes, { prefix: '/api/search' });
  await app.register(callsRoutes, { prefix: '/api/calls' });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.ready();
  return app;
}

export async function bootstrapIntegrationSuite(): Promise<{
  baseUrl: string;
  tenant: TestTenant;
}> {
  process.env.NODE_ENV = 'test';

  if (integrationState) {
    return {
      baseUrl: integrationState.baseUrl,
      tenant: integrationState.tenant,
    };
  }

  cleanupStarted = false;

  const timestamp = Date.now();
  const schemaName = `test_${timestamp}`;
  const slug = `test-${timestamp}`;

  await ensurePublicSchemaMigrations();
  const { tenant, user } = await ensureTestTenant(schemaName, slug);
  const app = await createIsolatedTestServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSocketServer(app.server as any);
  const addressInfo = app.server.address();
  if (!addressInfo || typeof addressInfo === 'string') {
    throw new Error('Falha ao resolver endereço HTTP do app de teste');
  }

  const baseUrl = `http://127.0.0.1:${addressInfo.port}`;
  integrationState = { app, baseUrl, tenant, user };

  globalThis.__ZIRADESK_TEST_BASE_URL__ = baseUrl;
  globalThis.__ZIRADESK_TEST_TENANT_ID__ = tenant.id;
  globalThis.__ZIRADESK_TEST_TENANT_SLUG__ = tenant.slug;
  globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__ = tenant.schemaName;

  return { baseUrl, tenant };
}

export function createTestApp(baseUrl?: string): ReturnType<typeof request> {
  const resolvedBaseUrl = baseUrl ?? globalThis.__ZIRADESK_TEST_BASE_URL__;
  if (!resolvedBaseUrl) {
    throw new Error('App de teste não inicializado. Execute bootstrapIntegrationSuite() antes de createTestApp().');
  }
  return request(resolvedBaseUrl);
}

export function createTestJWT(overrides: JwtOverrides = {}): string {
  const tenantId = overrides.tenantId ?? globalThis.__ZIRADESK_TEST_TENANT_ID__;
  const schemaName = overrides.schemaName ?? globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  const defaultUser = integrationState?.user;

  if (!overrides.isSuperAdmin && (!tenantId || !schemaName)) {
    throw new Error('Tenant de teste não configurado para gerar JWT');
  }

  return jwt.sign(
    {
      sub: overrides.sub ?? defaultUser?.id ?? TEST_USER.id,
      email: overrides.email ?? defaultUser?.email ?? TEST_USER.email,
      name: overrides.name ?? defaultUser?.name ?? TEST_USER.name,
      role: overrides.role ?? defaultUser?.role ?? TEST_USER.role,
      tenantId: overrides.isSuperAdmin ? undefined : tenantId,
      schemaName: overrides.isSuperAdmin ? undefined : schemaName,
      isSuperAdmin: overrides.isSuperAdmin ?? false,
      iatMs: Date.now(),
    },
    env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

export async function cleanupSchema(schemaNameArg?: string): Promise<void> {
  const schemaName = schemaNameArg
    ?? integrationState?.tenant.schemaName
    ?? globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!schemaName) return;

  const safeSchemaName = validateSchemaName(schemaName);

  const dbSchemaName = parseDatabaseUrlSchemaName(env.DATABASE_URL);
  if (safeSchemaName === dbSchemaName || safeSchemaName === 'public') {
    throw new Error(`Schema de segurança bloqueado para cleanup: ${safeSchemaName}`);
  }

  await prisma.tenant.deleteMany({ where: { schemaName: safeSchemaName } });
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${safeSchemaName}" CASCADE`);
}

export async function shutdownIntegrationSuite(): Promise<void> {
  if (cleanupStarted) return;
  cleanupStarted = true;

  const state = integrationState;
  integrationState = null;

  if (state) {
    await state.app.close().catch(() => undefined);
    await cleanupSchema(state.tenant.schemaName).catch(() => undefined);
  }

  await prisma.$disconnect().catch(() => undefined);
  redis.disconnect();

  globalThis.__ZIRADESK_TEST_BASE_URL__ = undefined;
  globalThis.__ZIRADESK_TEST_TENANT_ID__ = undefined;
  globalThis.__ZIRADESK_TEST_TENANT_SLUG__ = undefined;
  globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__ = undefined;
}
