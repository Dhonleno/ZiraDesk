import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';
import { getMonitorSnapshot } from './monitor.service.js';
import { getTvSnapshot } from './tv.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

const AGENT_ID = '00000000-0000-0000-0000-000000000312';

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

async function createTempTenant(): Promise<TempTenant> {
  const suffix = uniqueSuffix();
  const slug = `monitor-${suffix.replace(/_/g, '-')}`;
  const schemaName = `monitor_${suffix}`.toLowerCase();
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
      name: `Tenant Monitor ${suffix}`,
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
     VALUES ($1::uuid, 'Agent Monitor', 'agent.monitor@ziradesk.test', 'hash', 'agent', 'active', 'pt-BR', '{}')`,
    AGENT_ID,
  );
  return tenant;
}

async function createContact(schemaName: string, name: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".contacts (id, name, email, phone, whatsapp)
     VALUES (gen_random_uuid(), $1, 'monitor@ziradesk.test', '5511999990000', '5511999990000')
     RETURNING id`,
    name,
  );
  return rows[0]!.id;
}

async function createChannel(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".channels (id, name, type, status, credentials)
     VALUES (gen_random_uuid(), 'Canal Monitor', 'whatsapp', 'active', '{}'::jsonb)
     RETURNING id`,
  );
  return rows[0]!.id;
}

describe('Monitor em tempo real integration', () => {
  let tenant: TempTenant;

  beforeAll(async () => {
    tenant = await createTempTenant();
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
  });

  it('conta apenas conversas na fila humana como Em Espera', async () => {
    const channelId = await createChannel(tenant.schemaName);
    const botContactId = await createContact(tenant.schemaName, 'Contato no Bot');
    const queueContactId = await createContact(tenant.schemaName, 'Contato na Fila');

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".conversations
         (id, contact_id, channel_id, channel_type, conversation_type, status, assigned_to, queue_entered_at, metadata)
       VALUES
         (gen_random_uuid(), $1::uuid, $3::uuid, 'whatsapp', 'inbound', 'open', NULL, NULL, '{"bot_stage":"waiting_choice"}'::jsonb),
         (gen_random_uuid(), $2::uuid, $3::uuid, 'whatsapp', 'inbound', 'open', NULL, NOW() - INTERVAL '5 minutes', '{}'::jsonb)`,
      botContactId,
      queueContactId,
      channelId,
    );

    const tv = await getTvSnapshot(tenant.schemaName);
    const monitor = await getMonitorSnapshot(tenant.schemaName);

    expect(tv.conversations.queued).toBe(1);
    expect(tv.conversationCards).toHaveLength(1);
    expect(tv.conversationCards[0]?.contactName).toBe('Contato na Fila');
    expect(tv.conversationCards[0]?.queueEnteredAt).toEqual(expect.any(String));
    expect(monitor.queue.total).toBe(1);
  });
});
