import { prisma } from '../../config/database.js';
import { quoteIdent } from './conversations/protocols.js';
import type { CreateGoalInput, UpdateGoalInput } from './goals.schema.js';

interface GoalRow {
  id: string;
  name: string;
  scope: 'global' | 'agent' | 'group';
  agent_id: string | null;
  bot_option_id: string | null;
  period: 'daily' | 'weekly' | 'monthly';
  goal_tma_minutes: number | null;
  goal_tme_minutes: number | null;
  goal_sla_percent: number | null;
  goal_csat_min: number | null;
  goal_volume_min: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  agent_name: string | null;
  bot_option_label: string | null;
}

type GoalScope = 'global' | 'agent';
type GoalPeriod = GoalRow['period'];

interface NormalizedGoalPayload {
  name: string;
  scope: GoalScope;
  agentId: string | null;
  period: GoalPeriod;
  goalTmaMinutes: number | null;
  goalTmeMinutes: number | null;
  goalSlaPercent: number | null;
  goalCsatMin: number | null;
  goalVolumeMin: number | null;
  isActive: boolean;
}

export class GoalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalConflictError';
  }
}

export class GoalNotFoundError extends Error {
  constructor() {
    super('Meta não encontrada');
    this.name = 'GoalNotFoundError';
  }
}

const initializedGoalSchemas = new Set<string>();
const inFlightGoalSchemas = new Map<string, Promise<void>>();

function toSafeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }
  return schemaName;
}

async function resolveSchemaName(tenantId?: string): Promise<string | null> {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  if (!tenant) return null;
  return toSafeSchemaName(tenant.schemaName);
}

export async function resolveGoalsSchema(tenantId?: string): Promise<string | null> {
  return resolveSchemaName(tenantId);
}

export async function ensureGoalsInfrastructure(schemaName: string): Promise<void> {
  if (initializedGoalSchemas.has(schemaName)) return;

  const running = inFlightGoalSchemas.get(schemaName);
  if (running) {
    await running;
    return;
  }

  const task = (async () => {
    const schemaRef = quoteIdent(schemaName);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}.performance_goals (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name              VARCHAR(100) NOT NULL,
        scope             VARCHAR(20)  NOT NULL DEFAULT 'global',
        agent_id          UUID REFERENCES ${schemaRef}.users(id) ON DELETE CASCADE,
        bot_option_id     UUID,
        period            VARCHAR(20)  NOT NULL DEFAULT 'monthly',
        goal_tma_minutes  INTEGER,
        goal_tme_minutes  INTEGER,
        goal_sla_percent  INTEGER,
        goal_csat_min     DECIMAL(3,2),
        goal_volume_min   INTEGER,
        is_active         BOOLEAN      NOT NULL DEFAULT true,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE(scope, agent_id, bot_option_id, period)
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_performance_goals_active
      ON ${schemaRef}.performance_goals(is_active)
    `);

    initializedGoalSchemas.add(schemaName);
  })().finally(() => {
    inFlightGoalSchemas.delete(schemaName);
  });

  inFlightGoalSchemas.set(schemaName, task);
  await task;
}

function mapGoalRow(row: GoalRow) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    agentId: row.agent_id,
    agentName: row.agent_name,
    botOptionId: row.bot_option_id,
    botOptionLabel: row.bot_option_label,
    period: row.period,
    goalTmaMinutes: row.goal_tma_minutes,
    goalTmeMinutes: row.goal_tme_minutes,
    goalSlaPercent: row.goal_sla_percent,
    goalCsatMin: row.goal_csat_min,
    goalVolumeMin: row.goal_volume_min,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function normalizeScopeTargets(scope: GoalScope, agentId: string | null) {
  if (scope === 'global') {
    return { agentId: null };
  }
  if (!agentId) throw new Error('agentId é obrigatório para metas por agente');
  return { agentId };
}

function toGoalScope(value: GoalRow['scope'] | GoalScope): GoalScope | null {
  if (value === 'global' || value === 'agent') return value;
  return null;
}

function toNormalizedPayload(input: CreateGoalInput): NormalizedGoalPayload {
  const targets = normalizeScopeTargets(
    input.scope,
    input.agentId ?? null,
  );

  return {
    name: input.name.trim(),
    scope: input.scope,
    agentId: targets.agentId,
    period: input.period,
    goalTmaMinutes: input.goalTmaMinutes ?? null,
    goalTmeMinutes: input.goalTmeMinutes ?? null,
    goalSlaPercent: input.goalSlaPercent ?? null,
    goalCsatMin: input.goalCsatMin ?? null,
    goalVolumeMin: input.goalVolumeMin ?? null,
    isActive: input.isActive ?? true,
  };
}

async function findGoalById(schemaName: string, id: string): Promise<GoalRow | null> {
  const schemaRef = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<GoalRow[]>(`
    SELECT
      g.id,
      g.name,
      g.scope,
      g.agent_id,
      g.bot_option_id,
      g.period,
      g.goal_tma_minutes,
      g.goal_tme_minutes,
      g.goal_sla_percent,
      g.goal_csat_min,
      g.goal_volume_min,
      g.is_active,
      g.created_at,
      g.updated_at,
      u.name AS agent_name,
      bo.label AS bot_option_label
    FROM ${schemaRef}.performance_goals g
    LEFT JOIN ${schemaRef}.users u ON u.id = g.agent_id
    LEFT JOIN ${schemaRef}.bot_options bo ON bo.id = g.bot_option_id
    WHERE g.id = $1::uuid
    LIMIT 1
  `, id);

  return rows[0] ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  const raw = error as { code?: string; meta?: { code?: string; message?: string } };
  const dbCode = raw?.meta?.code;
  return raw?.code === 'P2010' && (dbCode === '23505' || raw?.meta?.message?.includes('duplicate key') === true);
}

export async function listGoals(schemaName: string, includeInactive = false) {
  await ensureGoalsInfrastructure(schemaName);

  const schemaRef = quoteIdent(schemaName);
  const whereSql = includeInactive ? '' : 'WHERE g.is_active = true';
  const rows = await prisma.$queryRawUnsafe<GoalRow[]>(`
    SELECT
      g.id,
      g.name,
      g.scope,
      g.agent_id,
      g.bot_option_id,
      g.period,
      g.goal_tma_minutes,
      g.goal_tme_minutes,
      g.goal_sla_percent,
      g.goal_csat_min,
      g.goal_volume_min,
      g.is_active,
      g.created_at,
      g.updated_at,
      u.name AS agent_name,
      bo.label AS bot_option_label
    FROM ${schemaRef}.performance_goals g
    LEFT JOIN ${schemaRef}.users u ON u.id = g.agent_id
    LEFT JOIN ${schemaRef}.bot_options bo ON bo.id = g.bot_option_id
    ${whereSql}
    ORDER BY g.created_at DESC
  `);

  return rows.map(mapGoalRow);
}

export async function createGoal(schemaName: string, payload: CreateGoalInput) {
  await ensureGoalsInfrastructure(schemaName);

  const normalized = toNormalizedPayload(payload);
  const schemaRef = quoteIdent(schemaName);

  try {
    const rows = await prisma.$queryRawUnsafe<GoalRow[]>(`
      INSERT INTO ${schemaRef}.performance_goals (
        name,
        scope,
        agent_id,
        bot_option_id,
        period,
        goal_tma_minutes,
        goal_tme_minutes,
        goal_sla_percent,
        goal_csat_min,
        goal_volume_min,
        is_active
      )
      VALUES (
        $1::varchar,
        $2::varchar,
        $3::uuid,
        $4::uuid,
        $5::varchar,
        $6::integer,
        $7::integer,
        $8::integer,
        $9::numeric,
        $10::integer,
        $11::boolean
      )
      RETURNING
        id,
        name,
        scope,
        agent_id,
        bot_option_id,
        period,
        goal_tma_minutes,
        goal_tme_minutes,
        goal_sla_percent,
        goal_csat_min,
        goal_volume_min,
        is_active,
        created_at,
        updated_at,
        NULL::text AS agent_name,
        NULL::text AS bot_option_label
    `,
    normalized.name,
    normalized.scope,
    normalized.agentId,
    null,
    normalized.period,
    normalized.goalTmaMinutes,
    normalized.goalTmeMinutes,
    normalized.goalSlaPercent,
    normalized.goalCsatMin,
    normalized.goalVolumeMin,
    normalized.isActive);

    const created = rows[0];
    if (!created) throw new Error('Falha ao criar meta');
    const complete = await findGoalById(schemaName, created.id);
    if (!complete) throw new Error('Falha ao carregar meta criada');
    return mapGoalRow(complete);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new GoalConflictError('Já existe uma meta para esta combinação de escopo e período');
    }
    throw error;
  }
}

export async function updateGoal(schemaName: string, id: string, payload: UpdateGoalInput) {
  await ensureGoalsInfrastructure(schemaName);

  const current = await findGoalById(schemaName, id);
  if (!current) throw new GoalNotFoundError();

  const mergedScope = toGoalScope(payload.scope ?? current.scope);
  if (!mergedScope) {
    throw new Error('Metas por grupo não podem ser editadas. Crie uma meta global ou por agente.');
  }
  const mergedAgentId = payload.agentId !== undefined ? payload.agentId : current.agent_id;
  const targets = normalizeScopeTargets(mergedScope, mergedAgentId);

  const normalized: NormalizedGoalPayload = {
    name: (payload.name ?? current.name).trim(),
    scope: mergedScope,
    agentId: targets.agentId,
    period: (payload.period ?? current.period) as GoalPeriod,
    goalTmaMinutes: payload.goalTmaMinutes !== undefined ? payload.goalTmaMinutes : current.goal_tma_minutes,
    goalTmeMinutes: payload.goalTmeMinutes !== undefined ? payload.goalTmeMinutes : current.goal_tme_minutes,
    goalSlaPercent: payload.goalSlaPercent !== undefined ? payload.goalSlaPercent : current.goal_sla_percent,
    goalCsatMin: payload.goalCsatMin !== undefined ? payload.goalCsatMin : current.goal_csat_min,
    goalVolumeMin: payload.goalVolumeMin !== undefined ? payload.goalVolumeMin : current.goal_volume_min,
    isActive: payload.isActive ?? current.is_active,
  };

  const schemaRef = quoteIdent(schemaName);

  try {
    await prisma.$executeRawUnsafe(`
      UPDATE ${schemaRef}.performance_goals
      SET
        name = $2::varchar,
        scope = $3::varchar,
        agent_id = $4::uuid,
        bot_option_id = $5::uuid,
        period = $6::varchar,
        goal_tma_minutes = $7::integer,
        goal_tme_minutes = $8::integer,
        goal_sla_percent = $9::integer,
        goal_csat_min = $10::numeric,
        goal_volume_min = $11::integer,
        is_active = $12::boolean,
        updated_at = NOW()
      WHERE id = $1::uuid
    `,
    id,
    normalized.name,
    normalized.scope,
    normalized.agentId,
    null,
    normalized.period,
    normalized.goalTmaMinutes,
    normalized.goalTmeMinutes,
    normalized.goalSlaPercent,
    normalized.goalCsatMin,
    normalized.goalVolumeMin,
    normalized.isActive);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new GoalConflictError('Já existe uma meta para esta combinação de escopo e período');
    }
    throw error;
  }

  const updated = await findGoalById(schemaName, id);
  if (!updated) throw new GoalNotFoundError();
  return mapGoalRow(updated);
}

export async function deleteGoal(schemaName: string, id: string) {
  await ensureGoalsInfrastructure(schemaName);
  const schemaRef = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    DELETE FROM ${schemaRef}.performance_goals
    WHERE id = $1::uuid
    RETURNING id
  `, id);

  if (!rows[0]) throw new GoalNotFoundError();
  return { id: rows[0].id };
}
