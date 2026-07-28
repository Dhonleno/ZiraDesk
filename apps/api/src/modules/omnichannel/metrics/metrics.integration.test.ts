import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/database.js';
import { provisionTenantSchema } from '../../super-admin/tenants/tenants.service.js';
import {
  SYSTEM_CLOSE_TYPE_ID,
  SYSTEM_OUTCOME_IDS,
} from '../../../database/seeds/closeConfig.seed.js';
import {
  getByAgent,
  getByChannel,
  getByDepartment,
  getOverview,
  getPeakHours,
  getVolumeByPeriod,
} from './metrics.service.js';

interface TempTenant { id: string; schemaName: string }

let tenant: TempTenant;
let agentId: string;

// A janela consultada é o dia 10. O dataset é montado de propósito com
// created_at != closed_at: se as métricas de encerramento estivessem no eixo de
// abertura (ou vice-versa), os números abaixo mudariam.
const WINDOW_FROM = '2026-03-10T00:00:00.000Z';
const WINDOW_TO_EXCLUSIVE = '2026-03-11T00:00:00.000Z';

const filters = {
  dateFrom: new Date(WINDOW_FROM),
  dateTo: new Date('2026-03-10T23:59:59.999Z'),
  dateToExclusive: new Date(WINDOW_TO_EXCLUSIVE),
};

async function createTempTenant(): Promise<TempTenant> {
  const suffix = Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000);
  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: {},
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

  const t = await prisma.tenant.create({
    data: {
      name: `Tenant Metrics ${suffix}`,
      slug: `metrics-${suffix}`,
      schemaName: `metrics_${suffix}`,
      planId: plan.id,
      status: 'active',
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, schemaName: true },
  });

  await provisionTenantSchema(t.schemaName);
  return { id: t.id, schemaName: t.schemaName };
}

async function createAgent(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".users (name, email, password_hash, role, status)
     VALUES ('Agente Métricas', 'agente.metricas@test.local', 'x', 'agent', 'active')
     RETURNING id::text`,
  );
  return rows[0]!.id;
}

async function insertConversation(
  schemaName: string,
  conv: {
    createdAt: string;
    closedAt?: string | null;
    status: 'open' | 'closed' | 'waiting';
    closeTypeId?: string | null;
    closeOutcomeId?: string | null;
    assignedTo?: string | null;
  },
): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".conversations
       (channel_type, conversation_type, status, created_at,
        closed_at, resolved_at, close_type_id, close_outcome_id, assigned_to)
     VALUES ('whatsapp', 'inbound', $1::"${schemaName}".conversation_status, $2::timestamptz,
             $3::timestamptz, $3::timestamptz, $4, $5, $6::uuid)
     RETURNING id::text`,
    conv.status,
    conv.createdAt,
    conv.closedAt ?? null,
    conv.closeTypeId ?? null,
    conv.closeOutcomeId ?? null,
    conv.assignedTo ?? null,
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  tenant = await createTempTenant();
  agentId = await createAgent(tenant.schemaName);

  // X — aberta dia 1, ENCERRADA dentro da janela (dia 10 12:00).
  await insertConversation(tenant.schemaName, {
    createdAt: '2026-03-01T00:00:00.000Z',
    closedAt: '2026-03-10T12:00:00.000Z',
    status: 'closed',
    closeTypeId: SYSTEM_CLOSE_TYPE_ID,
    closeOutcomeId: SYSTEM_OUTCOME_IDS.NO_REPLY,
    assignedTo: agentId,
  });

  // W — aberta dia 5, ENCERRADA dentro da janela (dia 10 18:00), outro desfecho.
  await insertConversation(tenant.schemaName, {
    createdAt: '2026-03-05T00:00:00.000Z',
    closedAt: '2026-03-10T18:00:00.000Z',
    status: 'closed',
    closeTypeId: SYSTEM_CLOSE_TYPE_ID,
    closeOutcomeId: SYSTEM_OUTCOME_IDS.INACTIVITY,
  });

  // Y — ABERTA dentro da janela (dia 10 09:00) e ainda em aberto.
  await insertConversation(tenant.schemaName, {
    createdAt: '2026-03-10T09:00:00.000Z',
    closedAt: null,
    status: 'open',
    assignedTo: agentId,
  });

  // Z — reaberta: status 'open' com close_* pendurados, o estado que o botão de
  // reabrir e assignConversation produzem. Aberta E encerrada dentro da janela de
  // propósito: assim ela cai em ambos os eixos, e só o predicado `status='closed'`
  // pode excluí-la — é o que separa este teste de um falso positivo.
  await insertConversation(tenant.schemaName, {
    createdAt: '2026-03-10T07:00:00.000Z',
    closedAt: '2026-03-10T15:00:00.000Z',
    status: 'open',
    closeTypeId: SYSTEM_CLOSE_TYPE_ID,
    closeOutcomeId: SYSTEM_OUTCOME_IDS.BY_CLIENT,
  });

  // V — ABERTA dentro da janela (dia 10 08:00), encerrada FORA dela (dia 20).
  await insertConversation(tenant.schemaName, {
    createdAt: '2026-03-10T08:00:00.000Z',
    closedAt: '2026-03-20T10:00:00.000Z',
    status: 'closed',
    closeTypeId: SYSTEM_CLOSE_TYPE_ID,
    closeOutcomeId: SYSTEM_OUTCOME_IDS.QUEUE_24H,
  });
});

afterAll(async () => {
  if (tenant) {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`);
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  }
});

describe('Métricas de encerramento — eixo temporal e predicados', () => {
  it('byType e byOutcome contam o que ENCERROU na janela, não o que abriu', async () => {
    const overview = await getOverview(filters, tenant.schemaName);

    // X e W encerraram no dia 10. Z está reaberta, V encerrou no dia 20.
    expect(overview.byType).toHaveLength(1);
    expect(overview.byType[0]).toMatchObject({ typeId: SYSTEM_CLOSE_TYPE_ID, count: 2 });

    const outcomeIds = overview.byOutcome.map((row) => row.outcomeId).sort();
    expect(outcomeIds).toEqual([SYSTEM_OUTCOME_IDS.INACTIVITY, SYSTEM_OUTCOME_IDS.NO_REPLY].sort());
    expect(overview.byOutcome.every((row) => row.count === 1)).toBe(true);
  });

  it('byType e byOutcome têm população idêntica', async () => {
    const overview = await getOverview(filters, tenant.schemaName);

    const byTypeTotal = overview.byType.reduce((sum, row) => sum + row.count, 0);
    const byOutcomeTotal = overview.byOutcome.reduce((sum, row) => sum + row.count, 0);

    expect(byTypeTotal).toBe(byOutcomeTotal);
    expect(byTypeTotal).toBe(2);
  });

  it('conversa reaberta (open com close_* preenchidos) fica fora dos dois agregados', async () => {
    const overview = await getOverview(filters, tenant.schemaName);

    // Z encerrou no dia 10 e tem close_outcome_id, mas voltou para 'open':
    // antes do alinhamento ela entrava em byOutcome e não em byType.
    expect(overview.byOutcome.map((row) => row.outcomeId)).not.toContain(SYSTEM_OUTCOME_IDS.BY_CLIENT);
    expect(
      overview.byType.reduce((sum, row) => sum + row.count, 0),
    ).toBe(
      overview.byOutcome.reduce((sum, row) => sum + row.count, 0),
    );
  });

  it('conversa encerrada fora da janela não entra em byType/byOutcome mesmo tendo aberto dentro', async () => {
    const overview = await getOverview(filters, tenant.schemaName);

    // V abriu dia 10 (entra em total.total) e encerrou dia 20 (fica fora daqui).
    expect(overview.byOutcome.map((row) => row.outcomeId)).not.toContain(SYSTEM_OUTCOME_IDS.QUEUE_24H);
  });

  it('tma usa resolved_at: média das encerradas NA janela', async () => {
    const overview = await getOverview(filters, tenant.schemaName);

    // X: 01/03 00:00 → 10/03 12:00 = 13680 min. W: 05/03 00:00 → 10/03 18:00 = 8280 min.
    // Z e V ficam fora (reaberta / encerrada fora da janela).
    expect(overview.tma).toBe((13680 + 8280) / 2);
  });
});

describe('Métricas de abertura — permanecem no eixo created_at', () => {
  it('total.* conta o que ABRIU na janela', async () => {
    const overview = await getOverview(filters, tenant.schemaName);

    // Z (07:00), V (08:00) e Y (09:00) abriram no dia 10. X e W abriram antes.
    expect(overview.total.total).toBe(3);
    expect(overview.total.open).toBe(2);      // Y e Z
    expect(overview.total.resolved).toBe(1);  // V (aberta na janela, hoje fechada)
    expect(overview.total.bot).toBe(0);
  });

  it('getVolumeByPeriod agrupa pela data de abertura', async () => {
    const volume = await getVolumeByPeriod(filters, tenant.schemaName);

    expect(volume).toHaveLength(1);
    expect(volume[0]).toMatchObject({ date: '2026-03-10', total: 3 });
  });

  it('getPeakHours usa a hora de abertura, não a de encerramento', async () => {
    const peak = await getPeakHours(filters, tenant.schemaName);

    // Z/V/Y abriram 07:00, 08:00 e 09:00. Se o eixo tivesse mudado, veríamos
    // 12, 15 e 18 (as horas de encerramento).
    expect(peak.map((row) => row.hour).sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });

  it('getByChannel e getByDepartment contam pela abertura', async () => {
    const [byChannel, byDepartment] = await Promise.all([
      getByChannel(filters, tenant.schemaName),
      getByDepartment(filters, tenant.schemaName),
    ]);

    expect(byChannel).toHaveLength(1);
    expect(byChannel[0]).toMatchObject({ channel_type: 'whatsapp', total: 3 });
    expect(byDepartment.reduce((sum, row) => sum + row.total, 0)).toBe(3);
  });

  it('getByAgent conta pela abertura', async () => {
    const byAgent = await getByAgent(filters, tenant.schemaName);

    // X e Y estão atribuídas ao agente, mas só Y abriu na janela.
    expect(byAgent).toHaveLength(1);
    expect(byAgent[0]).toMatchObject({ agent_id: agentId, total: 1 });
  });
});
