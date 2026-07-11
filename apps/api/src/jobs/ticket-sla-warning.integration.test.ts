import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../config/database.js';
import { sendEmail } from '../services/email.service.js';
import { provisionTenantSchema } from '../modules/super-admin/tenants/tenants.service.js';
import { ensureTicketInfrastructureForSchema } from '../modules/tickets/tickets.service.js';
import { processTicketSlaWarningForTenant, type TenantRow } from './ticket-sla-warning.job.js';

// Stub email so tests don't require SMTP
vi.mock('../services/email.service.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  hasTenantEmailProvider: vi.fn().mockResolvedValue(true),
}));

const AGENT_USER_ID = '00000000-0000-0000-0000-000000000051';
const AGENT_NAME = 'SLA Warning Agent';
const AGENT_EMAIL = 'sla.warning.agent@ziradesk.test';

let suiteTenant: TenantRow | null = null;

const sendEmailMock = vi.mocked(sendEmail);

function requireSuiteTenant(): TenantRow {
  if (!suiteTenant) throw new Error('Tenant da suite ticket-sla-warning não inicializado');
  return suiteTenant;
}

function wasEmailSentTo(email: string): boolean {
  return sendEmailMock.mock.calls.some(([options]) => {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    return recipients.some((recipient) => recipient.toLowerCase() === email.toLowerCase());
  });
}

async function createTempTenant(): Promise<TenantRow> {
  const suffix = Date.now().toString().slice(-8);
  const slug = `ticket-sla-warning-${suffix}`;
  const schemaName = `ticket_sla_warning_${suffix}`;

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
      name: `Tenant SLA Warning ${slug}`,
      slug,
      schemaName,
      planId: plan.id,
      status: 'active',
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, schemaName: true, name: true, slug: true, settings: true },
  });

  await provisionTenantSchema(schemaName);
  await ensureTicketInfrastructureForSchema(schemaName);

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".users (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, $2, $3, 'not_used_in_jwt_tests', 'agent', 'active', 'pt-BR', '{}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET role = 'agent', status = 'active'`,
    AGENT_USER_ID,
    AGENT_NAME,
    AGENT_EMAIL,
  );

  return tenant;
}

async function destroyTenant(tenant: TenantRow): Promise<void> {
  await prisma.tenant.deleteMany({ where: { schemaName: tenant.schemaName } });
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`);
}

async function createTicketDueIn(minutes: number, warningSentAt: Date | null): Promise<string> {
  const { schemaName } = requireSuiteTenant();
  const dueDate = new Date(Date.now() + minutes * 60_000);
  const id = randomUUID();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".tickets
       (id, title, status, priority, assigned_to, due_date, sla_warning_sent_at)
     VALUES ($1::uuid, $2, 'open', 'medium', $3::uuid, $4::timestamptz, $5::timestamptz)`,
    id,
    `Ticket SLA warning ${id}`,
    AGENT_USER_ID,
    dueDate.toISOString(),
    warningSentAt ? warningSentAt.toISOString() : null,
  );

  return id;
}

async function getTicketWarningSentAt(ticketId: string): Promise<Date | null> {
  const { schemaName } = requireSuiteTenant();
  const rows = await prisma.$queryRawUnsafe<Array<{ sla_warning_sent_at: Date | null }>>(
    `SELECT sla_warning_sent_at FROM "${schemaName}".tickets WHERE id = $1::uuid`,
    ticketId,
  );
  return rows[0]?.sla_warning_sent_at ?? null;
}

beforeAll(async () => {
  suiteTenant = await createTempTenant();
});

afterAll(async () => {
  if (suiteTenant) await destroyTenant(suiteTenant);
});

beforeEach(async () => {
  const { schemaName } = requireSuiteTenant();
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${schemaName}".tickets RESTART IDENTITY CASCADE`);
  sendEmailMock.mockClear();
});

describe('Ticket SLA warning job — processTicketSlaWarningForTenant', () => {
  it('envia o email de aviso e marca sla_warning_sent_at quando o ticket vence em 20min e ainda não foi avisado', async () => {
    const ticketId = await createTicketDueIn(20, null);

    await processTicketSlaWarningForTenant(requireSuiteTenant());

    expect(wasEmailSentTo(AGENT_EMAIL)).toBe(true);

    const warningSentAt = await getTicketWarningSentAt(ticketId);
    expect(warningSentAt).not.toBeNull();
  });

  it('não reenvia o email quando sla_warning_sent_at já está preenchido', async () => {
    const alreadySentAt = new Date(Date.now() - 5 * 60_000);
    await createTicketDueIn(20, alreadySentAt);

    await processTicketSlaWarningForTenant(requireSuiteTenant());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
