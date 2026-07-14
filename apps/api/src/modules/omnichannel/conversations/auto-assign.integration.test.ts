import { Prisma } from '@prisma/client';
import type { Server } from 'socket.io';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../config/database.js';
import { createTestJWT } from '../../../test/setup.js';
import { ensureSkillsInfrastructure } from '../../admin/skills/skills.infrastructure.js';
import { provisionTenantSchema } from '../../super-admin/tenants/tenants.service.js';
import {
  autoAssignConversation,
  ensureAgentAssignmentsInfrastructure,
  ensureConversationRoutingInfrastructure,
} from './auto-assign.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

const AGENT_ID = '00000000-0000-0000-0000-000000000321';

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function mockIo(): Server {
  return {
    in: vi.fn(() => ({
      fetchSockets: vi.fn().mockResolvedValue([{}]),
    })),
    to: vi.fn(() => ({
      emit: vi.fn(),
    })),
  } as unknown as Server;
}

async function createTempTenant(): Promise<TempTenant> {
  const suffix = uniqueSuffix();
  const slug = `auto-assign-${suffix.replace(/_/g, '-')}`;
  const schemaName = `auto_assign_${suffix}`.toLowerCase();
  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: {
      name: 'Plano Teste',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: {
        whatsapp: true,
        email: true,
        live_chat: true,
        reports: true,
        api_access: true,
        custom_domain: true,
        sla: true,
        webhooks: true,
      },
    },
    create: {
      name: 'Plano Teste',
      slug: 'test-plan',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: {
        whatsapp: true,
        email: true,
        live_chat: true,
        reports: true,
        api_access: true,
        custom_domain: true,
        sla: true,
        webhooks: true,
      },
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant Auto Assign ${suffix}`,
      slug,
      schemaName,
      planId: plan.id,
      status: 'active',
      trialEndsAt: null,
      settings: {
        auto_assign: true,
        auto_assign_algorithm: 'round_robin',
        routing_skill_timeout_ms: 120_000,
      },
    },
    select: { id: true, schemaName: true },
  });

  await provisionTenantSchema(tenant.schemaName);
  await ensureSkillsInfrastructure(prisma, tenant.schemaName);
  await ensureConversationRoutingInfrastructure(prisma, tenant.schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, tenant.schemaName);

  return tenant;
}

async function resetTenantData(tenant: TempTenant): Promise<void> {
  await ensureSkillsInfrastructure(prisma, tenant.schemaName);
  await ensureConversationRoutingInfrastructure(prisma, tenant.schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, tenant.schemaName);

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "${tenant.schemaName}".messages,
      "${tenant.schemaName}".conversation_assignments,
      "${tenant.schemaName}".audit_logs,
      "${tenant.schemaName}".agent_skills,
      "${tenant.schemaName}".bot_option_skills,
      "${tenant.schemaName}".skills,
      "${tenant.schemaName}".agent_departments,
      "${tenant.schemaName}".agent_bot_skills,
      "${tenant.schemaName}".agent_assignments,
      "${tenant.schemaName}".conversations,
      "${tenant.schemaName}".bot_options,
      "${tenant.schemaName}".departments,
      "${tenant.schemaName}".users
    RESTART IDENTITY CASCADE
  `);

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      settings: {
        auto_assign: true,
        auto_assign_algorithm: 'round_robin',
        routing_skill_timeout_ms: 120_000,
      },
    },
  });
}

async function createDepartment(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".departments (name)
     VALUES ('Suporte')
     RETURNING id`,
  );
  return rows[0]!.id;
}

async function createAgent(schemaName: string, params: {
  id?: string;
  departmentId?: string;
  skillIds?: string[];
  status?: 'online' | 'offline';
  isAvailable?: boolean;
} = {}): Promise<string> {
  const agentId = params.id ?? AGENT_ID;
  const status = params.status ?? 'online';
  const isAvailable = params.isAvailable ?? true;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".users (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, 'Agente Auto Assign', $2, 'hash', 'agent', 'active', 'pt-BR', '{}'::jsonb)`,
    agentId,
    `agent.${agentId}@ziradesk.test`,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".agent_assignments
       (user_id, status, is_available, last_seen_at, active_conversations)
     VALUES ($1::uuid, $2, $3::boolean, NOW(), 0)`,
    agentId,
    status,
    isAvailable,
  );

  if (params.departmentId) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".agent_departments (user_id, department_id)
       VALUES ($1::uuid, $2::uuid)`,
      agentId,
      params.departmentId,
    );
  }

  for (const skillId of params.skillIds ?? []) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".agent_skills (user_id, skill_id)
       VALUES ($1::uuid, $2::uuid)`,
      agentId,
      skillId,
    );
  }

  return agentId;
}

async function createBotOption(schemaName: string, departmentId?: string | null): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".bot_options (number, label, department_id)
     VALUES (1, 'Financeiro', $1::uuid)
     RETURNING id`,
    departmentId ?? null,
  );
  return rows[0]!.id;
}

async function createSkill(schemaName: string, botOptionId?: string): Promise<string> {
  const skillRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".skills (name)
     VALUES ($1)
     RETURNING id`,
    `Skill ${uniqueSuffix()}`,
  );
  const skillId = skillRows[0]!.id;

  if (botOptionId) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".bot_option_skills (bot_option_id, skill_id, required)
       VALUES ($1::uuid, $2::uuid, true)`,
      botOptionId,
      skillId,
    );
  }

  return skillId;
}

async function createConversation(schemaName: string, params: {
  departmentId?: string | null;
  botOptionId?: string | null;
  routingStartedAtSql?: string;
} = {}): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".conversations
       (channel_type, conversation_type, status, department_id, bot_option_id, routing_started_at, metadata)
     VALUES ('whatsapp', 'inbound', 'open', $1::uuid, $2::uuid, ${params.routingStartedAtSql ?? 'NULL'}, '{}'::jsonb)
     RETURNING id`,
    params.departmentId ?? null,
    params.botOptionId ?? null,
  );
  return rows[0]!.id;
}

async function assignedTo(schemaName: string, conversationId: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ assigned_to: string | null }>>(
    `SELECT assigned_to
     FROM "${schemaName}".conversations
     WHERE id = $1::uuid`,
    conversationId,
  );
  return rows[0]?.assigned_to ?? null;
}

describe('autoAssignConversation AND logic integration', () => {
  let tenant: TempTenant;

  beforeAll(async () => {
    tenant = await createTempTenant();
    createTestJWT({
      sub: AGENT_ID,
      role: 'agent',
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetTenantData(tenant);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
  });

  it('retorna agente com departamento correto e todas as skills obrigatórias da opção', async () => {
    const departmentId = await createDepartment(tenant.schemaName);
    const botOptionId = await createBotOption(tenant.schemaName, departmentId);
    const skillId = await createSkill(tenant.schemaName, botOptionId);
    const agentId = await createAgent(tenant.schemaName, { departmentId, skillIds: [skillId] });
    const conversationId = await createConversation(tenant.schemaName, { departmentId, botOptionId });

    const result = await autoAssignConversation(
      conversationId,
      tenant.id,
      tenant.schemaName,
      prisma,
      mockIo(),
      undefined,
      botOptionId,
    );

    expect(result).toBe(agentId);
    expect(await assignedTo(tenant.schemaName, conversationId)).toBe(agentId);
  });

  it('retorna null quando agente do departamento não tem skill e timeout ainda não expirou', async () => {
    const departmentId = await createDepartment(tenant.schemaName);
    const botOptionId = await createBotOption(tenant.schemaName, departmentId);
    await createSkill(tenant.schemaName, botOptionId);
    await createAgent(tenant.schemaName, { departmentId });
    const conversationId = await createConversation(tenant.schemaName, { departmentId, botOptionId });

    const result = await autoAssignConversation(
      conversationId,
      tenant.id,
      tenant.schemaName,
      prisma,
      mockIo(),
      undefined,
      botOptionId,
    );

    expect(result).toBeNull();
    expect(await assignedTo(tenant.schemaName, conversationId)).toBeNull();
  });

  it('após timeout, retorna agente do departamento mesmo sem skill e registra fallback', async () => {
    const departmentId = await createDepartment(tenant.schemaName);
    const botOptionId = await createBotOption(tenant.schemaName, departmentId);
    await createSkill(tenant.schemaName, botOptionId);
    const agentId = await createAgent(tenant.schemaName, { departmentId });
    const conversationId = await createConversation(tenant.schemaName, {
      departmentId,
      botOptionId,
      routingStartedAtSql: "NOW() - INTERVAL '3 minutes'",
    });

    const result = await autoAssignConversation(
      conversationId,
      tenant.id,
      tenant.schemaName,
      prisma,
      mockIo(),
      undefined,
      botOptionId,
    );

    const fallbackLogs = await prisma.$queryRawUnsafe<Array<{ action: string }>>(
      `SELECT action
       FROM "${tenant.schemaName}".audit_logs
       WHERE entity_id = $1::uuid
         AND action = 'conversation.routing_fallback'`,
      conversationId,
    );

    expect(result).toBe(agentId);
    expect(fallbackLogs).toHaveLength(1);
  });

  it('sem bot_option_id, com department_id, retorna agente do departamento', async () => {
    const departmentId = await createDepartment(tenant.schemaName);
    const agentId = await createAgent(tenant.schemaName, { departmentId });
    const conversationId = await createConversation(tenant.schemaName, { departmentId });

    const result = await autoAssignConversation(
      conversationId,
      tenant.id,
      tenant.schemaName,
      prisma,
      mockIo(),
    );

    expect(result).toBe(agentId);
  });

  it('sem bot_option_id e sem department_id, usa round-robin geral', async () => {
    const agentId = await createAgent(tenant.schemaName);
    const conversationId = await createConversation(tenant.schemaName);

    const result = await autoAssignConversation(
      conversationId,
      tenant.id,
      tenant.schemaName,
      prisma,
      mockIo(),
    );

    expect(result).toBe(agentId);
  });

  it('não retorna agente offline', async () => {
    const departmentId = await createDepartment(tenant.schemaName);
    const botOptionId = await createBotOption(tenant.schemaName, departmentId);
    const skillId = await createSkill(tenant.schemaName, botOptionId);
    await createAgent(tenant.schemaName, { departmentId, skillIds: [skillId], status: 'offline', isAvailable: false });
    const conversationId = await createConversation(tenant.schemaName, { departmentId, botOptionId });

    const result = await autoAssignConversation(
      conversationId,
      tenant.id,
      tenant.schemaName,
      prisma,
      mockIo(),
      undefined,
      botOptionId,
    );

    expect(result).toBeNull();
  });

  it('bot_option sem bot_option_skills não filtra por skill e retorna agente do departamento', async () => {
    const departmentId = await createDepartment(tenant.schemaName);
    const botOptionId = await createBotOption(tenant.schemaName, departmentId);
    const agentId = await createAgent(tenant.schemaName, { departmentId });
    const conversationId = await createConversation(tenant.schemaName, { departmentId, botOptionId });

    const result = await autoAssignConversation(
      conversationId,
      tenant.id,
      tenant.schemaName,
      prisma,
      mockIo(),
      undefined,
      botOptionId,
    );

    expect(result).toBe(agentId);
  });
});
