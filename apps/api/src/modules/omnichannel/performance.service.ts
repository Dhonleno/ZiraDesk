import { prisma } from '../../config/database.js';
import { quoteIdent } from './conversations/protocols.js';
import { ensureGoalsInfrastructure } from './goals.service.js';
import type { PerformanceQuery } from './performance.schema.js';

type GoalPeriod = 'daily' | 'weekly' | 'monthly';
type GoalStatus = 'ok' | 'warning' | 'breach' | 'no_goal';

interface PerformanceRowDb {
  agent_id: string;
  agent_name: string;
  avatar_url: string | null;
  total_conversations: number | bigint | null;
  avg_tma_minutes: number | null;
  avg_tme_minutes: number | null;
  avg_csat: number | null;
  csat_count: number | bigint | null;
  sla_percent: number | null;
  sla_ok: number | bigint | null;
  sla_breach: number | bigint | null;
}

interface GoalDbRow {
  id: string;
  name: string;
  scope: 'global' | 'agent';
  agent_id: string | null;
  bot_option_id: string | null;
  period: GoalPeriod;
  goal_tma_minutes: number | null;
  goal_tme_minutes: number | null;
  goal_sla_percent: number | null;
  goal_csat_min: number | null;
  goal_volume_min: number | null;
}

interface TeamKpisRow {
  total_volume: number | bigint | null;
  avg_tma_minutes: number | null;
  avg_tme_minutes: number | null;
  avg_csat: number | null;
  sla_percent: number | null;
}

interface PerformanceCsvRow {
  agent: string;
  volume: string;
  tma: string;
  tme: string;
  sla: string;
  csat: string;
  status: string;
}

function toSafeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }
  return schemaName;
}

export async function resolvePerformanceSchema(tenantId?: string): Promise<string | null> {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  if (!tenant) return null;
  return toSafeSchemaName(tenant.schemaName);
}

function getDateIsoInTimeZone(timeZone: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function addDaysToIsoDate(dateIso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!match) return dateIso;

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveDateRange(
  period: PerformanceQuery['period'],
  timezone: string,
  dateFrom?: string,
  dateTo?: string,
): { dateFromLocal: string; dateToLocal: string } {
  const today = getDateIsoInTimeZone(timezone);

  if (period === 'custom') {
    return {
      dateFromLocal: dateFrom?.trim() || today,
      dateToLocal: dateTo?.trim() || today,
    };
  }

  if (period === 'today') {
    return { dateFromLocal: today, dateToLocal: today };
  }

  if (period === 'yesterday') {
    const yesterday = addDaysToIsoDate(today, -1);
    return { dateFromLocal: yesterday, dateToLocal: yesterday };
  }

  if (period === 'month') {
    return { dateFromLocal: `${today.slice(0, 8)}01`, dateToLocal: today };
  }

  if (period === 'last_week') {
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const dow = todayDate.getUTCDay(); // 0=Dom, 1=Seg, …, 6=Sáb
    const daysToThisMonday = dow === 0 ? 6 : dow - 1;
    const lastMonday = addDaysToIsoDate(today, -(daysToThisMonday + 7));
    return { dateFromLocal: lastMonday, dateToLocal: addDaysToIsoDate(lastMonday, 6) };
  }

  if (period === 'last_month') {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const firstOfLastMonth = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const firstOfThisMonth = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    return { dateFromLocal: firstOfLastMonth, dateToLocal: addDaysToIsoDate(firstOfThisMonth, -1) };
  }

  const days = period === '30d' ? 30 : 7;
  return {
    dateFromLocal: addDaysToIsoDate(today, -days),
    dateToLocal: today,
  };
}

function toNumber(value: number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function toNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value);
}

function mapRangeToGoalPeriod(period: PerformanceQuery['period'], dateFromLocal: string, dateToLocal: string): GoalPeriod {
  if (period === 'today' || period === 'yesterday') return 'daily';
  if (period === '7d' || period === 'last_week') return 'weekly';
  if (period === '30d' || period === 'month' || period === 'last_month') return 'monthly';

  const from = new Date(`${dateFromLocal}T00:00:00.000Z`).getTime();
  const to = new Date(`${dateToLocal}T00:00:00.000Z`).getTime();
  const diffDays = Math.max(1, Math.floor((to - from) / (1000 * 60 * 60 * 24)) + 1);
  if (diffDays <= 1) return 'daily';
  if (diffDays <= 7) return 'weekly';
  return 'monthly';
}

function checkGoal(value: number | null, goal: number | null, type: 'max' | 'min'): GoalStatus {
  if (goal === null || value === null) return 'no_goal';
  if (type === 'max') {
    if (value <= goal * 0.9) return 'ok';
    if (value <= goal) return 'warning';
    return 'breach';
  }
  if (value >= goal) return 'ok';
  if (value >= goal * 0.9) return 'warning';
  return 'breach';
}

function resolveOverallStatus(statuses: GoalStatus[]): GoalStatus {
  const withGoals = statuses.filter((status) => status !== 'no_goal');
  if (withGoals.length === 0) return 'no_goal';
  if (withGoals.includes('breach')) return 'breach';
  if (withGoals.includes('warning')) return 'warning';
  return 'ok';
}

function formatMetric(value: number | null, format: 'minutes' | 'percent' | 'csat' | 'number'): string {
  if (value === null) return '—';
  if (format === 'minutes') {
    if (value < 60) return `${Math.round(value)}min`;
    return `${(value / 60).toFixed(1)}h`;
  }
  if (format === 'percent') return `${Math.round(value)}%`;
  if (format === 'csat') return `${value.toFixed(1)}★`;
  return String(Math.round(value));
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function serializePerformanceCsv(rows: PerformanceCsvRow[]): string {
  const headers = ['Agente', 'Volume', 'TMA', 'TME', 'SLA', 'CSAT', 'Status'];
  const lines = [headers.map(csvField).join(';')];
  for (const row of rows) {
    lines.push([
      row.agent,
      row.volume,
      row.tma,
      row.tme,
      row.sla,
      row.csat,
      row.status,
    ].map(csvField).join(';'));
  }
  return lines.join('\n');
}

function getPerformanceBaseFilters(
  query: PerformanceQuery,
  dateFromLocal: string,
  dateToLocal: string,
  timezone: string,
) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const pushParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const dateFromToken = pushParam(dateFromLocal);
  const dateToToken = pushParam(dateToLocal);
  const timezoneToken = pushParam(timezone);

  conditions.push(`c.status IN ('open', 'waiting', 'closed')`);
  conditions.push(`c.created_at >= ((${dateFromToken}::date)::timestamp AT TIME ZONE ${timezoneToken}::text)`);
  conditions.push(`c.created_at < ((((${dateToToken}::date + INTERVAL '1 day')::timestamp) AT TIME ZONE ${timezoneToken}::text))`);

  if (query.bot_option_id) {
    conditions.push(`c.metadata->>'bot_option_id' = ${pushParam(query.bot_option_id)}::text`);
  }

  const usersFilterParts: string[] = [
    `u.status = 'active'`,
    `u.role IN ('agent', 'supervisor', 'admin', 'owner')`,
  ];
  if (query.agent_id) {
    usersFilterParts.push(`u.id = ${pushParam(query.agent_id)}::uuid`);
  }

  return {
    conversationWhereSql: conditions.join(' AND '),
    usersWhereSql: usersFilterParts.join(' AND '),
    params,
  };
}

function pickGoalForAgent(
  goals: GoalDbRow[],
  agentId: string,
): GoalDbRow | null {
  const agentGoal = goals.find((goal) => goal.scope === 'agent' && goal.agent_id === agentId);
  if (agentGoal) return agentGoal;

  return goals.find((goal) => goal.scope === 'global') ?? null;
}

export async function listPerformance(
  schemaName: string,
  query: PerformanceQuery,
  timezone: string,
) {
  await ensureGoalsInfrastructure(schemaName);

  const dateRange = resolveDateRange(
    query.period,
    timezone,
    query.date_from,
    query.date_to,
  );

  if (dateRange.dateFromLocal > dateRange.dateToLocal) {
    throw new Error('Período inválido: date_from maior que date_to');
  }

  const safeSchema = quoteIdent(schemaName);
  const { conversationWhereSql, usersWhereSql, params } = getPerformanceBaseFilters(
    query,
    dateRange.dateFromLocal,
    dateRange.dateToLocal,
    timezone,
  );

  const page = query.page ?? 1;
  const perPage = query.per_page ?? 25;
  const offset = (page - 1) * perPage;

  const countRows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`
    SELECT COUNT(*) AS total
    FROM ${safeSchema}.users u
    WHERE ${usersWhereSql}
  `, ...params);
  const total = Number(countRows[0]?.total ?? 0);

  const limitToken = `$${params.length + 1}`;
  const offsetToken = `$${params.length + 2}`;
  const rows = await prisma.$queryRawUnsafe<PerformanceRowDb[]>(`
    WITH filtered_conversations AS (
      SELECT
        c.id,
        c.assigned_to,
        c.created_at,
        c.conversation_type,
        c.outbound_returned_at,
        CASE
          WHEN c.conversation_type = 'outbound' THEN c.outbound_returned_at
          ELSE c.created_at
        END AS performance_start_at,
        c.assigned_at,
        c.resolved_at,
        c.closed_at,
        c.last_message_at,
        c.status,
        c.csat_score,
        fr.first_response_seconds
      FROM ${safeSchema}.conversations c
      LEFT JOIN LATERAL (
        SELECT MIN(EXTRACT(EPOCH FROM (m.created_at - start_ref.performance_start_at))) AS first_response_seconds
        FROM ${safeSchema}.messages m
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN c.conversation_type = 'outbound' THEN c.outbound_returned_at
            ELSE c.created_at
          END AS performance_start_at
        ) start_ref
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'agent'
          AND m.is_internal = false
          AND start_ref.performance_start_at IS NOT NULL
          AND m.created_at >= start_ref.performance_start_at
      ) fr ON TRUE
      WHERE ${conversationWhereSql}
    )
    SELECT
      u.id AS agent_id,
      u.name AS agent_name,
      u.avatar_url,
      COUNT(fc.id)::bigint AS total_conversations,
      AVG(
        EXTRACT(EPOCH FROM (
          COALESCE(fc.resolved_at, fc.closed_at, fc.last_message_at) - fc.performance_start_at
        )) / 60
      ) FILTER (
        WHERE fc.status = 'closed'
          AND (fc.resolved_at IS NOT NULL OR fc.closed_at IS NOT NULL)
          AND fc.performance_start_at IS NOT NULL
      ) AS avg_tma_minutes,
      AVG(
        GREATEST(
          EXTRACT(EPOCH FROM (fc.assigned_at - fc.performance_start_at)),
          0
        ) / 60
      ) FILTER (
        WHERE fc.assigned_at IS NOT NULL
          AND fc.performance_start_at IS NOT NULL
      ) AS avg_tme_minutes,
      AVG(fc.csat_score) FILTER (WHERE fc.csat_score IS NOT NULL) AS avg_csat,
      COUNT(fc.id) FILTER (WHERE fc.csat_score IS NOT NULL)::bigint AS csat_count,
      ROUND(
        100.0 * COUNT(fc.id) FILTER (
          WHERE fc.first_response_seconds IS NOT NULL
            AND fc.first_response_seconds <= 300
        ) / NULLIF(
          COUNT(fc.id) FILTER (WHERE fc.first_response_seconds IS NOT NULL),
          0
        )
      ) AS sla_percent,
      COUNT(fc.id) FILTER (
        WHERE fc.first_response_seconds IS NOT NULL
          AND fc.first_response_seconds <= 300
      )::bigint AS sla_ok,
      COUNT(fc.id) FILTER (
        WHERE fc.first_response_seconds IS NOT NULL
          AND fc.first_response_seconds > 300
      )::bigint AS sla_breach
    FROM ${safeSchema}.users u
    LEFT JOIN filtered_conversations fc ON fc.assigned_to = u.id
    WHERE ${usersWhereSql}
    GROUP BY u.id, u.name, u.avatar_url
    ORDER BY total_conversations DESC, u.name ASC
    LIMIT ${limitToken}::integer OFFSET ${offsetToken}::integer
  `, ...params, perPage, offset);

  const teamRows = await prisma.$queryRawUnsafe<TeamKpisRow[]>(`
    WITH filtered_conversations AS (
      SELECT
        c.id,
        c.created_at,
        c.conversation_type,
        c.outbound_returned_at,
        CASE
          WHEN c.conversation_type = 'outbound' THEN c.outbound_returned_at
          ELSE c.created_at
        END AS performance_start_at,
        c.assigned_at,
        c.resolved_at,
        c.closed_at,
        c.last_message_at,
        c.status,
        c.csat_score,
        fr.first_response_seconds
      FROM ${safeSchema}.conversations c
      LEFT JOIN LATERAL (
        SELECT MIN(EXTRACT(EPOCH FROM (m.created_at - start_ref.performance_start_at))) AS first_response_seconds
        FROM ${safeSchema}.messages m
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN c.conversation_type = 'outbound' THEN c.outbound_returned_at
            ELSE c.created_at
          END AS performance_start_at
        ) start_ref
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'agent'
          AND m.is_internal = false
          AND start_ref.performance_start_at IS NOT NULL
          AND m.created_at >= start_ref.performance_start_at
      ) fr ON TRUE
      WHERE ${conversationWhereSql}
    )
    SELECT
      COUNT(fc.id)::bigint AS total_volume,
      AVG(
        EXTRACT(EPOCH FROM (
          COALESCE(fc.resolved_at, fc.closed_at, fc.last_message_at) - fc.performance_start_at
        )) / 60
      ) FILTER (
        WHERE fc.status = 'closed'
          AND (fc.resolved_at IS NOT NULL OR fc.closed_at IS NOT NULL)
          AND fc.performance_start_at IS NOT NULL
      ) AS avg_tma_minutes,
      AVG(
        GREATEST(
          EXTRACT(EPOCH FROM (fc.assigned_at - fc.performance_start_at)),
          0
        ) / 60
      ) FILTER (
        WHERE fc.assigned_at IS NOT NULL
          AND fc.performance_start_at IS NOT NULL
      ) AS avg_tme_minutes,
      AVG(fc.csat_score) FILTER (WHERE fc.csat_score IS NOT NULL) AS avg_csat,
      ROUND(
        100.0 * COUNT(fc.id) FILTER (
          WHERE fc.first_response_seconds IS NOT NULL
            AND fc.first_response_seconds <= 300
        ) / NULLIF(
          COUNT(fc.id) FILTER (WHERE fc.first_response_seconds IS NOT NULL),
          0
        )
      ) AS sla_percent
    FROM filtered_conversations fc
  `, ...params);

  const goalPeriod = mapRangeToGoalPeriod(query.period, dateRange.dateFromLocal, dateRange.dateToLocal);
  const goals = await prisma.$queryRawUnsafe<GoalDbRow[]>(`
    SELECT
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
      goal_volume_min
    FROM ${safeSchema}.performance_goals
    WHERE is_active = true
      AND period = $1::varchar
      AND (
        scope = 'global'
        OR scope = 'agent'
      )
    ORDER BY
      CASE scope
        WHEN 'agent' THEN 1
        ELSE 2
      END,
      updated_at DESC
  `, goalPeriod);

  const data = rows.map((row: PerformanceRowDb) => {
    const goal = pickGoalForAgent(goals, row.agent_id);
    const normalized = {
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      avatar_url: row.avatar_url,
      total_conversations: toNumber(row.total_conversations),
      avg_tma_minutes: toNullableNumber(row.avg_tma_minutes),
      avg_tme_minutes: toNullableNumber(row.avg_tme_minutes),
      avg_csat: toNullableNumber(row.avg_csat),
      csat_count: toNumber(row.csat_count),
      sla_percent: toNullableNumber(row.sla_percent),
      sla_ok: toNumber(row.sla_ok),
      sla_breach: toNumber(row.sla_breach),
    };

    const goalPayload = goal ? {
      id: goal.id,
      name: goal.name,
      scope: goal.scope,
      period: goal.period,
      goal_tma_minutes: goal.goal_tma_minutes,
      goal_tme_minutes: goal.goal_tme_minutes,
      goal_sla_percent: goal.goal_sla_percent,
      goal_csat_min: goal.goal_csat_min,
      goal_volume_min: goal.goal_volume_min,
    } : null;

    const tmaStatus = checkGoal(normalized.avg_tma_minutes, goal?.goal_tma_minutes ?? null, 'max');
    const tmeStatus = checkGoal(normalized.avg_tme_minutes, goal?.goal_tme_minutes ?? null, 'max');
    const slaStatus = checkGoal(normalized.sla_percent, goal?.goal_sla_percent ?? null, 'min');
    const csatStatus = checkGoal(normalized.avg_csat, goal?.goal_csat_min ?? null, 'min');
    const volumeStatus = checkGoal(normalized.total_conversations, goal?.goal_volume_min ?? null, 'min');
    const overallStatus = resolveOverallStatus([tmaStatus, tmeStatus, slaStatus, csatStatus, volumeStatus]);

    return {
      ...normalized,
      goal: goalPayload,
      goal_status: {
        tma: tmaStatus,
        tme: tmeStatus,
        sla: slaStatus,
        csat: csatStatus,
        volume: volumeStatus,
        overall: overallStatus,
      },
    };
  });

  const team = teamRows[0];

  return {
    data,
    meta: {
      total,
      page,
      perPage,
      totalPages: total > 0 ? Math.ceil(total / perPage) : 0,
    },
    team_kpis: {
      avg_tma_minutes: toNullableNumber(team?.avg_tma_minutes),
      avg_tme_minutes: toNullableNumber(team?.avg_tme_minutes),
      avg_csat: toNullableNumber(team?.avg_csat),
      sla_percent: toNullableNumber(team?.sla_percent),
      total_volume: toNumber(team?.total_volume),
    },
    applied_filters: {
      ...query,
      date_from: dateRange.dateFromLocal,
      date_to: dateRange.dateToLocal,
      timezone,
      goal_period: goalPeriod,
    },
  };
}

export function exportPerformanceCsv(data: Array<{
  agent_name: string;
  total_conversations: number;
  avg_tma_minutes: number | null;
  avg_tme_minutes: number | null;
  sla_percent: number | null;
  avg_csat: number | null;
  goal_status: { overall: GoalStatus };
}>): string {
  const rows: PerformanceCsvRow[] = data.map((row: {
    agent_name: string;
    total_conversations: number;
    avg_tma_minutes: number | null;
    avg_tme_minutes: number | null;
    sla_percent: number | null;
    avg_csat: number | null;
    goal_status: { overall: GoalStatus };
  }) => ({
    agent: row.agent_name,
    volume: formatMetric(row.total_conversations, 'number'),
    tma: formatMetric(row.avg_tma_minutes, 'minutes'),
    tme: formatMetric(row.avg_tme_minutes, 'minutes'),
    sla: formatMetric(row.sla_percent, 'percent'),
    csat: formatMetric(row.avg_csat, 'csat'),
    status: row.goal_status.overall,
  }));

  return serializePerformanceCsv(rows);
}
