import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { provisionTenantSchema } from './tenants/tenants.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

interface TempPlan {
  id: string;
  slug: string;
  name: string;
}

const tempTenants: TempTenant[] = [];
const tempPlans: TempPlan[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function superAdminAuth(): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      isSuperAdmin: true,
      role: 'super_admin',
      sub: 'super-admin-test-user',
      email: 'super-admin@ziradesk.test',
      name: 'Super Admin Test',
    })}`,
  };
}

function agentAuth(): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      role: 'agent',
      sub: 'agent-test-user',
      email: 'agent@ziradesk.test',
      name: 'Agent Test',
    })}`,
  };
}

async function createTempPlan(label: string): Promise<TempPlan> {
  const suffix = uniqueSuffix();
  const plan = await prisma.plan.create({
    data: {
      name: `${label} ${suffix}`,
      slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
      priceMonth: new Prisma.Decimal('99.90'),
      priceYear: new Prisma.Decimal('999.00'),
      maxUsers: 25,
      maxContacts: 500,
      isActive: true,
      features: {},
    },
    select: { id: true, slug: true, name: true },
  });

  tempPlans.push(plan);
  return plan;
}

async function createTempTenant(options: {
  planId: string;
  status?: 'active' | 'suspended' | 'trial' | 'cancelled';
}): Promise<TempTenant> {
  const suffix = uniqueSuffix();
  const schemaName = `test_super_admin_${suffix}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant Super Admin ${suffix}`,
      slug: `tenant-super-admin-${suffix}`,
      schemaName,
      planId: options.planId,
      status: options.status ?? 'active',
      trialEndsAt: options.status === 'trial' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
      settings: {},
    },
    select: { id: true, schemaName: true },
  });

  try {
    await provisionTenantSchema(schemaName);
  } catch (error) {
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
    throw error;
  }

  tempTenants.push(tenant);
  return tenant;
}

async function registerTempTenant(tenant: TempTenant): Promise<void> {
  tempTenants.push(tenant);
}

async function cleanupTempTenant(tenant: TempTenant): Promise<void> {
  await prisma.subscription.deleteMany({ where: { tenantId: tenant.id } }).catch(() => undefined);
  await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
}

async function schemaExists(schemaName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ schema_name: string }>>(
    `SELECT schema_name
       FROM information_schema.schemata
      WHERE schema_name = $1`,
    schemaName,
  );

  return rows.length > 0;
}

afterEach(async () => {
  while (tempTenants.length > 0) {
    await cleanupTempTenant(tempTenants.pop()!);
  }

  while (tempPlans.length > 0) {
    const plan = tempPlans.pop()!;
    await prisma.plan.deleteMany({ where: { id: plan.id } }).catch(() => undefined);
  }
});

describe('Super-admin integration', () => {
  it('GET /api/super-admin/tenants lista todos os tenants para super_admin', async () => {
    const plan = await createTempPlan('Plano Listagem');
    const tenantA = await createTempTenant({ planId: plan.id, status: 'active' });
    const tenantB = await createTempTenant({ planId: plan.id, status: 'trial' });

    const response = await createTestApp()
      .get('/api/super-admin/tenants?page=1&perPage=100')
      .set(superAdminAuth());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.meta).toMatchObject({
      total: expect.any(Number),
      page: 1,
      perPage: 100,
    });
    expect(response.body.meta.total).toBeGreaterThanOrEqual(2);

    const tenantIds = response.body.data.map((tenant: { id: string }) => tenant.id);
    expect(tenantIds).toContain(tenantA.id);
    expect(tenantIds).toContain(tenantB.id);
  });

  it('GET /api/super-admin/tenants com role agent retorna 403', async () => {
    const response = await createTestApp()
      .get('/api/super-admin/tenants?page=1&perPage=20')
      .set(agentAuth());

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Permissão insuficiente' },
    });
  });

  it('POST /api/super-admin/tenants cria tenant e schema isolado no Postgres', async () => {
    const plan = await createTempPlan('Plano Criacao');
    const suffix = uniqueSuffix();
    const slug = `tenant-api-${suffix.replace(/_/g, '-')}`;
    const expectedSchemaName = `tenant_${slug.replace(/-/g, '_')}`;

    const response = await createTestApp()
      .post('/api/super-admin/tenants')
      .set(superAdminAuth())
      .send({
        name: `Tenant API ${suffix}`,
        slug,
        planId: plan.id,
        ownerName: 'Owner API Test',
        ownerEmail: `owner.${suffix}@ziradesk.test`,
        trialDays: 10,
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.tempPassword).toHaveLength(12);
    expect(response.body.data.tenant).toMatchObject({
      name: `Tenant API ${suffix}`,
      slug,
      schemaName: expectedSchemaName,
    });

    const createdTenant = response.body.data.tenant as TempTenant & { slug: string };
    await registerTempTenant(createdTenant);

    expect(await schemaExists(createdTenant.schemaName)).toBe(true);

    const ownerRows = await prisma.$queryRawUnsafe<Array<{ name: string; email: string; role: string; status: string }>>(
      `SELECT name, email, role, status
         FROM "${createdTenant.schemaName}".users`,
    );

    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]).toMatchObject({
      name: 'Owner API Test',
      email: `owner.${suffix}@ziradesk.test`,
      role: 'owner',
      status: 'active',
    });
  });

  it('PATCH /api/super-admin/tenants/:id atualiza plano e status', async () => {
    const initialPlan = await createTempPlan('Plano Inicial');
    const nextPlan = await createTempPlan('Plano Atualizado');
    const tenant = await createTempTenant({ planId: initialPlan.id, status: 'active' });

    const response = await createTestApp()
      .patch(`/api/super-admin/tenants/${tenant.id}`)
      .set(superAdminAuth())
      .send({
        planId: nextPlan.id,
        status: 'suspended',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      id: tenant.id,
      planId: nextPlan.id,
      status: 'suspended',
    });

    const updatedTenant = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { planId: true, status: true },
    });

    expect(updatedTenant).toMatchObject({
      planId: nextPlan.id,
      status: 'suspended',
    });
  });

  it('GET /api/super-admin/metrics/overview retorna totais por status e plano', async () => {
    const planA = await createTempPlan('Plano Overview A');
    const planB = await createTempPlan('Plano Overview B');

    await createTempTenant({ planId: planA.id, status: 'active' });
    await createTempTenant({ planId: planA.id, status: 'trial' });
    await createTempTenant({ planId: planB.id, status: 'suspended' });
    await createTempTenant({ planId: planB.id, status: 'cancelled' });

    const response = await createTestApp()
      .get('/api/super-admin/metrics/overview')
      .set(superAdminAuth());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.totalTenants).toBeGreaterThanOrEqual(4);
    expect(response.body.data.activeTenants).toBeGreaterThanOrEqual(1);
    expect(response.body.data.trialTenants).toBeGreaterThanOrEqual(1);
    expect(response.body.data.suspendedTenants).toBeGreaterThanOrEqual(1);
    expect(response.body.data.cancelledTenants).toBeGreaterThanOrEqual(1);
    expect(response.body.data.totalPlans).toBeGreaterThanOrEqual(2);
    expect(response.body.data.totalTenants).toBe(
      response.body.data.activeTenants
      + response.body.data.trialTenants
      + response.body.data.suspendedTenants
      + response.body.data.cancelledTenants,
    );
    expect(response.body.data.totalPlans).toBe(response.body.data.tenantsByPlan.length);

    expect(response.body.data.tenantsByPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planName: planA.name, count: 2 }),
        expect.objectContaining({ planName: planB.name, count: 2 }),
      ]),
    );
  });
});