import Fastify from 'fastify';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../config/database.js';
import { authMiddleware } from './auth.js';
import { tenantMiddleware } from './tenant.js';
import { tenantSchemaFromJwt } from './tenantSchemaFromJwt.js';
import { provisionTenantSchema } from '../modules/super-admin/tenants/tenants.service.js';
import { createTestJWT } from '../test/setup.js';

interface TempTenant {
  id: string;
  slug: string;
  schemaName: string;
}

const tempTenants: TempTenant[] = [];

function requiredGlobal(name: 'slug' | 'schema' | 'tenantId'): string {
  if (name === 'slug') {
    const value = globalThis.__ZIRADESK_TEST_TENANT_SLUG__;
    if (!value) throw new Error('Tenant de teste não inicializado');
    return value;
  }
  if (name === 'schema') {
    const value = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
    if (!value) throw new Error('Schema de teste não inicializado');
    return value;
  }
  const value = globalThis.__ZIRADESK_TEST_TENANT_ID__;
  if (!value) throw new Error('Tenant ID de teste não inicializado');
  return value;
}

async function createTenant(status: 'active' | 'suspended'): Promise<TempTenant> {
  const now = Date.now();
  const random = Math.floor(Math.random() * 1_000_000);
  const slug = `it-${status}-${now}-${random}`;
  const schemaName = `it_${status}_${now}_${random}`;

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
      name: `Tenant ${slug}`,
      slug,
      schemaName,
      planId: plan.id,
      status,
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, slug: true, schemaName: true },
  });

  await provisionTenantSchema(schemaName);
  tempTenants.push(tenant);
  return tenant;
}

async function cleanupTempTenants(): Promise<void> {
  while (tempTenants.length > 0) {
    const tenant = tempTenants.pop()!;
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`);
  }
}

function buildApp() {
  const app = Fastify({ logger: false });

  app.get('/tenant-only', { preHandler: [tenantMiddleware] }, async (request) => ({
    tenantId: request.tenant.id,
    slug: request.tenant.slug,
    schemaName: request.tenant.schemaName,
  }));

  app.get('/tenant-secure', { preHandler: [tenantMiddleware, authMiddleware, tenantSchemaFromJwt] }, async () => ({
    ok: true,
  }));

  return app;
}

describe('Tenant middleware integration', () => {
  afterEach(async () => {
    await cleanupTempTenants();
    vi.restoreAllMocks();
  });

  it('requisição com subdomínio válido resolve tenant e popula request.tenant', async () => {
    const app = buildApp();
    const slug = requiredGlobal('slug');
    const schemaName = requiredGlobal('schema');

    const response = await app.inject({
      method: 'GET',
      url: '/tenant-only',
      headers: { host: `${slug}.ziradesk.local` },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ slug, schemaName });
  });

  it('requisição com subdomínio inexistente retorna 404', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/tenant-only',
      headers: { host: `inexistente-${Date.now()}.ziradesk.local` },
    });
    await app.close();

    expect(response.statusCode).toBe(404);
  });

  it('requisição com tenant suspenso retorna 402', async () => {
    const suspended = await createTenant('suspended');
    const app = buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/tenant-only',
      headers: { host: `${suspended.slug}.ziradesk.local` },
    });
    await app.close();

    expect(response.statusCode).toBe(402);
  });

  it('cross-tenant: JWT de tenant A é rejeitado em rota do tenant B', async () => {
    const tenantB = await createTenant('active');
    const tokenFromTenantA = createTestJWT({
      tenantId: requiredGlobal('tenantId'),
      schemaName: requiredGlobal('schema'),
      role: 'owner',
    });
    const app = buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/tenant-secure',
      headers: {
        host: `${tenantB.slug}.ziradesk.local`,
        authorization: `Bearer ${tokenFromTenantA}`,
      },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
  });
});
