import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

interface AgentIdentity {
  id: string;
  name: string;
  email: string;
}

const AGENT_A: AgentIdentity = {
  id: '00000000-0000-0000-0000-000000000041',
  name: 'Notifications Agent A',
  email: 'notifications.agent.a@ziradesk.test',
};

const AGENT_B: AgentIdentity = {
  id: '00000000-0000-0000-0000-000000000042',
  name: 'Notifications Agent B',
  email: 'notifications.agent.b@ziradesk.test',
};

const tempTenants: TempTenant[] = [];
let suiteTenant: TempTenant | null = null;

function requireSuiteTenant(): TempTenant {
  if (!suiteTenant) {
    throw new Error('Tenant dedicado da suite de notifications não inicializado');
  }

  return suiteTenant;
}

function authHeader(
  agent: AgentIdentity,
  tenant: TempTenant = requireSuiteTenant(),
): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: agent.id,
      email: agent.email,
      name: agent.name,
      role: 'agent',
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

function uniqueText(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function ensureAgent(schemaName: string, agent: AgentIdentity): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".users
       (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, $2, $3, $4, 'agent', 'active', 'pt-BR', '{}'::jsonb)
     ON CONFLICT (id)
     DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       role = 'agent',
       status = 'active',
       language = 'pt-BR',
       settings = '{}'::jsonb`,
    agent.id,
    agent.name,
    agent.email,
    'not_used_in_jwt_tests',
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".agent_assignments (user_id)
     VALUES ($1::uuid)
     ON CONFLICT (user_id) DO NOTHING`,
    agent.id,
  );
}

async function ensureNotificationReadsTable(schemaName: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${schemaName}".notification_reads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      notification_id UUID NOT NULL,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, notification_id)
    )
  `);
}

async function resetTenantNotificationData(schemaName: string): Promise<void> {
  await ensureNotificationReadsTable(schemaName);

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "${schemaName}".notification_reads,
      "${schemaName}".ticket_comments,
      "${schemaName}".ticket_events,
      "${schemaName}".ticket_checklists,
      "${schemaName}".ticket_relations,
      "${schemaName}".ticket_time_entries,
      "${schemaName}".ticket_attachments,
      "${schemaName}".tickets,
      "${schemaName}".audit_logs
    RESTART IDENTITY CASCADE
  `);

  await ensureAgent(schemaName, AGENT_A);
  await ensureAgent(schemaName, AGENT_B);
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
      status: 'active',
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, schemaName: true },
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

async function createAssignedNotification(
  tenant: TempTenant,
  agent: AgentIdentity,
  title = uniqueText('Ticket atribuido'),
): Promise<{ notificationId: string; ticketId: string }> {
  const ticketId = randomUUID();
  const notificationId = randomUUID();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tenant.schemaName}".tickets
       (id, title, status, priority, assigned_to)
     VALUES ($1::uuid, $2, 'open', 'medium', $3::uuid)`,
    ticketId,
    title,
    agent.id,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tenant.schemaName}".audit_logs
       (id, user_id, action, entity, entity_id, new_data, created_at)
     VALUES (
       $1::uuid,
       NULL,
       'ticket.assigned',
       'ticket',
       $2::uuid,
       jsonb_build_object('assigned_to', $3, 'title', $4),
       NOW()
     )`,
    notificationId,
    ticketId,
    agent.id,
    title,
  );

  return { notificationId, ticketId };
}

describe('Notifications integration', () => {
  beforeAll(async () => {
    suiteTenant = await createTempTenant(false);
  });

  beforeEach(async () => {
    const { schemaName } = requireSuiteTenant();
    await resetTenantNotificationData(schemaName);
  });

  afterEach(async () => {
    while (tempTenants.length > 0) {
      await dropTenant(tempTenants.pop()!);
    }
  });

  afterAll(async () => {
    if (!suiteTenant) {
      return;
    }

    await dropTenant(suiteTenant);
    suiteTenant = null;
  });

  it('GET /api/notifications lista notificações do usuário autenticado', async () => {
    const tenant = requireSuiteTenant();
    const ownNotification = await createAssignedNotification(tenant, AGENT_A, 'Ticket Agent A');
    await createAssignedNotification(tenant, AGENT_B, 'Ticket Agent B');

    const response = await createTestApp()
      .get('/api/notifications')
      .set(authHeader(AGENT_A));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: ownNotification.notificationId,
      type: 'ticket_assigned',
      title: 'Ticket atribuído',
      message: 'Você recebeu o ticket "Ticket Agent A".',
      read: false,
      href: `/tickets/${ownNotification.ticketId}`,
    });
    expect(response.body.meta).toMatchObject({
      total: 1,
      page: 1,
      per_page: 20,
      has_more: false,
    });
  });

  it('PATCH /api/notifications/:id/read marca notificação como lida', async () => {
    const tenant = requireSuiteTenant();
    const notification = await createAssignedNotification(tenant, AGENT_A, 'Ticket leitura');

    const patchResponse = await createTestApp()
      .patch(`/api/notifications/${notification.notificationId}/read`)
      .set(authHeader(AGENT_A));

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body).toMatchObject({
      success: true,
      data: { read: true },
    });

    const listResponse = await createTestApp()
      .get('/api/notifications')
      .set(authHeader(AGENT_A));

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(listResponse.body.data[0]).toMatchObject({
      id: notification.notificationId,
      read: true,
    });
  });

  it('notificação de um agente não aparece para outro agente do mesmo tenant', async () => {
    const tenant = requireSuiteTenant();
    const notificationA = await createAssignedNotification(tenant, AGENT_A, 'Ticket exclusivo A');
    const notificationB = await createAssignedNotification(tenant, AGENT_B, 'Ticket exclusivo B');

    const responseA = await createTestApp()
      .get('/api/notifications')
      .set(authHeader(AGENT_A));

    const responseB = await createTestApp()
      .get('/api/notifications')
      .set(authHeader(AGENT_B));

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect(responseA.body.data.map((item: { id: string }) => item.id)).toEqual([notificationA.notificationId]);
    expect(responseB.body.data.map((item: { id: string }) => item.id)).toEqual([notificationB.notificationId]);
  });

  it('isola notificações entre tenants', async () => {
    const tenantA = requireSuiteTenant();
    const tenantB = await createTempTenant();

    await resetTenantNotificationData(tenantB.schemaName);

    const notificationA = await createAssignedNotification(tenantA, AGENT_A, 'Ticket tenant A');
    const notificationB = await createAssignedNotification(tenantB, AGENT_A, 'Ticket tenant B');

    const response = await createTestApp()
      .get('/api/notifications')
      .set(authHeader(AGENT_A, tenantB));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: notificationB.notificationId });
    expect(response.body.data[0].id).not.toBe(notificationA.notificationId);
  });
});