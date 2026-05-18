import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../../config/database.js';
import { ensureConversationProtocolInfrastructure } from '../conversations/protocols.js';
import { ensureConversationCsatInfrastructure } from '../conversations/csat.infrastructure.js';
import { ensureCloseConfigInfrastructure } from '../../admin/close-config/close-config.service.js';

interface MetricsFilters {
  dateFrom: Date;
  dateTo: Date;
  dateToExclusive: Date;
  agentId?: string;
  channelType?: string;
  department?: string;
}

type MetricsDbClient = Pick<PrismaClient, '$transaction'>;
type TxClient = Prisma.TransactionClient;
const initializedMetricSchemas = new Set<string>();

function toSafeSchema(schemaName: string): string {
  return schemaName.replace(/"/g, '""');
}

async function ensureMetricsInfrastructure(schemaName: string): Promise<void> {
  if (initializedMetricSchemas.has(schemaName)) return;

  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  await ensureCloseConfigInfrastructure(schemaName);

  initializedMetricSchemas.add(schemaName);
}

async function withTenantSchema<T>(
  db: MetricsDbClient,
  schemaName: string,
  run: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const safeSchema = toSafeSchema(schemaName);
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchema}", public`);
    return run(tx);
  });
}

function addCommonFilters(
  where: string[],
  params: unknown[],
  filters: MetricsFilters,
  alias?: string,
): void {
  const prefix = alias ? `${alias}.` : '';
  params.push(filters.dateFrom);
  where.push(`${prefix}created_at >= $${params.length}::timestamptz`);
  params.push(filters.dateToExclusive);
  where.push(`${prefix}created_at < $${params.length}::timestamptz`);

  if (filters.agentId) {
    params.push(filters.agentId);
    where.push(`${prefix}assigned_to = $${params.length}::uuid`);
  }

  if (filters.channelType) {
    params.push(filters.channelType);
    where.push(`${prefix}channel_type = $${params.length}::text`);
  }

  if (filters.department) {
    params.push(filters.department);
    where.push(`COALESCE(${prefix}metadata->>'bot_department', 'Sem departamento') = $${params.length}::text`);
  }
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function toPercentage(count: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

export async function getOverview(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
  await ensureMetricsInfrastructure(schemaName);

  return withTenantSchema(db, schemaName, async (tx) => {
    const where: string[] = [];
    const params: unknown[] = [];
    addCommonFilters(where, params, filters);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRows = await tx.$queryRawUnsafe<Array<{
      total: bigint;
      resolved: bigint;
      open: bigint;
      bot: bigint;
    }>>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
         COUNT(*) FILTER (WHERE status IN ('open', 'pending')) AS open,
         COUNT(*) FILTER (WHERE status = 'bot') AS bot
       FROM conversations
       ${whereSql}`,
      ...params,
    );

    const tmaRows = await tx.$queryRawUnsafe<Array<{ avg_minutes: number | null }>>(
      `SELECT
         ROUND(AVG(EXTRACT(EPOCH FROM (
           resolved_at - COALESCE(
             CASE
               WHEN conversation_type = 'outbound' THEN outbound_returned_at
               ELSE NULL
             END,
             created_at
           )
         )) / 60))::integer AS avg_minutes
       FROM conversations
       ${whereSql}
       ${whereSql ? 'AND' : 'WHERE'} status = 'resolved'
       AND resolved_at IS NOT NULL`,
      ...params,
    );

    const firstResponseWhere: string[] = [];
    const firstResponseParams: unknown[] = [];
    addCommonFilters(firstResponseWhere, firstResponseParams, filters, 'c');
    const firstResponseWhereSql = firstResponseWhere.length ? `WHERE ${firstResponseWhere.join(' AND ')}` : '';

    const firstResponseRows = await tx.$queryRawUnsafe<Array<{ avg_minutes: number | null }>>(
      `WITH first_responses AS (
         SELECT
           c.id,
           c.created_at,
           c.conversation_type,
           c.outbound_returned_at,
           MIN(m.created_at) FILTER (
             WHERE m.sender_type = 'agent'
               AND m.is_internal = false
           ) AS first_agent_message_at
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         ${firstResponseWhereSql}
         GROUP BY c.id, c.created_at
       )
       SELECT
         ROUND(
           AVG(EXTRACT(EPOCH FROM (
             first_agent_message_at - COALESCE(
               CASE
                 WHEN conversation_type = 'outbound' THEN outbound_returned_at
                 ELSE NULL
               END,
               created_at
             )
           )) / 60)
         )::integer AS avg_minutes
       FROM first_responses
       WHERE first_agent_message_at IS NOT NULL`,
      ...firstResponseParams,
    );

    const csatWhere: string[] = ['csat_score IS NOT NULL'];
    const csatParams: unknown[] = [];
    addCommonFilters(csatWhere, csatParams, filters);
    const csatWhereSql = csatWhere.length ? `WHERE ${csatWhere.join(' AND ')}` : '';

    const csatRows = await tx.$queryRawUnsafe<Array<{
      avg_score: number | null;
      total_responses: bigint;
      positive: bigint;
    }>>(
      `SELECT
         ROUND(AVG(csat_score)::numeric, 1) AS avg_score,
         COUNT(*) AS total_responses,
         COUNT(*) FILTER (WHERE csat_score >= 4) AS positive
       FROM conversations
       ${csatWhereSql}`,
      ...csatParams,
    );

    const total = totalRows[0];
    const csat = csatRows[0];
    const byTypeWhere: string[] = ['c.close_type_id IS NOT NULL', `c.status IN ('resolved', 'closed')`];
    const byTypeParams: unknown[] = [];
    addCommonFilters(byTypeWhere, byTypeParams, filters, 'c');
    const byTypeWhereSql = byTypeWhere.length ? `WHERE ${byTypeWhere.join(' AND ')}` : '';

    const byTypeRows = await tx.$queryRawUnsafe<Array<{
      type_id: string;
      label: string;
      total: bigint;
    }>>(
      `SELECT
         c.close_type_id AS type_id,
         COALESCE(ct.label, c.close_type_id) AS label,
         COUNT(*) AS total
       FROM conversations c
       LEFT JOIN conversation_close_types ct
         ON ct.id = c.close_type_id
       ${byTypeWhereSql}
       GROUP BY c.close_type_id, ct.label
       ORDER BY total DESC`,
      ...byTypeParams,
    );

    const byOutcomeWhere: string[] = ['c.close_outcome_id IS NOT NULL'];
    const byOutcomeParams: unknown[] = [];
    addCommonFilters(byOutcomeWhere, byOutcomeParams, filters, 'c');
    const byOutcomeWhereSql = byOutcomeWhere.length ? `WHERE ${byOutcomeWhere.join(' AND ')}` : '';

    const byOutcomeRows = await tx.$queryRawUnsafe<Array<{
      outcome_id: string;
      label: string;
      total: bigint;
    }>>(
      `SELECT
         c.close_outcome_id AS outcome_id,
         COALESCE(co.label, c.close_outcome_id) AS label,
         COUNT(*) AS total
       FROM conversations c
       LEFT JOIN conversation_close_outcomes co
         ON co.id = c.close_outcome_id
       ${byOutcomeWhereSql}
       GROUP BY c.close_outcome_id, co.label
       ORDER BY total DESC`,
      ...byOutcomeParams,
    );

    const byTypeTotal = byTypeRows.reduce((sum, row) => sum + toNumber(row.total), 0);
    const byOutcomeTotal = byOutcomeRows.reduce((sum, row) => sum + toNumber(row.total), 0);

    return {
      total: {
        total: toNumber(total?.total),
        resolved: toNumber(total?.resolved),
        open: toNumber(total?.open),
        bot: toNumber(total?.bot),
      },
      tma: tmaRows[0]?.avg_minutes ?? 0,
      first_response_minutes: firstResponseRows[0]?.avg_minutes ?? 0,
      csat: {
        avg_score: csat?.avg_score ?? null,
        total_responses: toNumber(csat?.total_responses),
        positive: toNumber(csat?.positive),
      },
      byType: byTypeRows.map((row) => {
        const count = toNumber(row.total);
        return {
          typeId: row.type_id,
          label: row.label,
          count,
          percentage: toPercentage(count, byTypeTotal),
        };
      }),
      byOutcome: byOutcomeRows.map((row) => {
        const count = toNumber(row.total);
        return {
          outcomeId: row.outcome_id,
          label: row.label,
          count,
          percentage: toPercentage(count, byOutcomeTotal),
        };
      }),
    };
  });
}

export async function getVolumeByPeriod(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
  await ensureMetricsInfrastructure(schemaName);

  return withTenantSchema(db, schemaName, async (tx) => {
    const where: string[] = [];
    const params: unknown[] = [];
    addCommonFilters(where, params, filters);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await tx.$queryRawUnsafe<Array<{
      date: Date;
      total: bigint;
      resolved: bigint;
    }>>(
      `SELECT
         DATE(created_at) AS date,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
       FROM conversations
       ${whereSql}
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      ...params,
    );

    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      total: toNumber(row.total),
      resolved: toNumber(row.resolved),
    }));
  });
}

export async function getByAgent(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
  await ensureMetricsInfrastructure(schemaName);

  return withTenantSchema(db, schemaName, async (tx) => {
    const where: string[] = ['c.assigned_to IS NOT NULL'];
    const params: unknown[] = [];
    addCommonFilters(where, params, filters, 'c');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await tx.$queryRawUnsafe<Array<{
      agent_name: string;
      agent_id: string;
      total: bigint;
      resolved: bigint;
      avg_minutes: number | null;
      avg_csat: number | null;
    }>>(
      `SELECT
         u.name AS agent_name,
         u.id AS agent_id,
         COUNT(c.id) AS total,
         COUNT(c.id) FILTER (WHERE c.status = 'resolved') AS resolved,
         ROUND(AVG(EXTRACT(EPOCH FROM (
           c.resolved_at - COALESCE(
             CASE
               WHEN c.conversation_type = 'outbound' THEN c.outbound_returned_at
               ELSE NULL
             END,
             c.created_at
           )
         )) / 60))::integer AS avg_minutes,
         ROUND(AVG(c.csat_score)::numeric, 1) AS avg_csat
       FROM conversations c
       JOIN users u ON u.id = c.assigned_to
       ${whereSql}
       GROUP BY u.id, u.name
       ORDER BY total DESC`,
      ...params,
    );

    return rows.map((row) => ({
      ...row,
      total: toNumber(row.total),
      resolved: toNumber(row.resolved),
    }));
  });
}

export async function getByChannel(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
  await ensureMetricsInfrastructure(schemaName);

  return withTenantSchema(db, schemaName, async (tx) => {
    const where: string[] = [];
    const params: unknown[] = [];
    addCommonFilters(where, params, filters);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await tx.$queryRawUnsafe<Array<{ channel_type: string; total: bigint }>>(
      `SELECT
         channel_type,
         COUNT(*) AS total
       FROM conversations
       ${whereSql}
       GROUP BY channel_type
       ORDER BY total DESC`,
      ...params,
    );

    return rows.map((row) => ({ ...row, total: toNumber(row.total) }));
  });
}

export async function getByDepartment(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
  await ensureMetricsInfrastructure(schemaName);

  return withTenantSchema(db, schemaName, async (tx) => {
    const where: string[] = [];
    const params: unknown[] = [];
    addCommonFilters(where, params, filters);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await tx.$queryRawUnsafe<Array<{
      department: string;
      total: bigint;
      avg_csat: number | null;
    }>>(
      `SELECT
         COALESCE(metadata->>'bot_department', 'Sem departamento') AS department,
         COUNT(*) AS total,
         ROUND(AVG(csat_score)::numeric, 1) AS avg_csat
       FROM conversations
       ${whereSql}
       GROUP BY metadata->>'bot_department'
       ORDER BY total DESC`,
      ...params,
    );

    return rows.map((row) => ({ ...row, total: toNumber(row.total) }));
  });
}

export async function getPeakHours(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
  await ensureMetricsInfrastructure(schemaName);

  return withTenantSchema(db, schemaName, async (tx) => {
    const where: string[] = [];
    const params: unknown[] = [];
    addCommonFilters(where, params, filters);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await tx.$queryRawUnsafe<Array<{
      day_of_week: number;
      hour: number;
      total: bigint;
    }>>(
      `SELECT
         EXTRACT(DOW FROM created_at)::integer AS day_of_week,
         EXTRACT(HOUR FROM created_at)::integer AS hour,
         COUNT(*) AS total
       FROM conversations
       ${whereSql}
       GROUP BY day_of_week, hour
       ORDER BY day_of_week, hour`,
      ...params,
    );

    return rows.map((row) => ({
      day_of_week: row.day_of_week,
      hour: row.hour,
      total: toNumber(row.total),
    }));
  });
}

export async function getMyStats(
  agentId: string,
  filters: { dateFromLocal: string; dateToLocal: string; timezone: string },
  schemaName: string,
  db: MetricsDbClient = prisma,
) {
  await ensureMetricsInfrastructure(schemaName);

  return withTenantSchema(db, schemaName, async (tx) => {
    const safeSchema = toSafeSchema(schemaName);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchema}", public`);

    const statsRows = await tx.$queryRawUnsafe<Array<{
      total: bigint;
      resolved: bigint;
      avg_minutes: number | null;
      avg_csat: number | null;
      sla_pct: number | null;
    }>>(
      `SELECT
         COUNT(c.id) AS total,
         COUNT(c.id) FILTER (WHERE c.status = 'resolved') AS resolved,
         ROUND(AVG(EXTRACT(EPOCH FROM (
           c.resolved_at - COALESCE(
             CASE WHEN c.conversation_type = 'outbound' THEN c.outbound_returned_at ELSE NULL END,
             c.created_at
           )
         )) / 60))::integer AS avg_minutes,
         ROUND(AVG(c.csat_score)::numeric, 1) AS avg_csat,
         ROUND(
           COUNT(c.id) FILTER (
             WHERE fr.first_response_seconds IS NOT NULL
               AND fr.first_response_seconds <= 300
           ) * 100.0 / NULLIF(COUNT(c.id), 0),
           1
         ) AS sla_pct
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT MIN(EXTRACT(EPOCH FROM (m.created_at - c.created_at))) AS first_response_seconds
         FROM messages m
         WHERE m.conversation_id = c.id
           AND m.sender_type = 'agent'
           AND m.is_internal = false
       ) fr ON true
       WHERE c.assigned_to = $1::uuid
         AND c.conversation_type IS DISTINCT FROM 'outbound'
         AND (c.metadata->>'origin') IS DISTINCT FROM 'active_outbound'
         AND c.created_at >= (($2::date)::timestamp AT TIME ZONE $4::text)
         AND c.created_at < ((($3::date + INTERVAL '1 day')::timestamp) AT TIME ZONE $4::text)`,
      agentId,
      filters.dateFromLocal,
      filters.dateToLocal,
      filters.timezone,
    );

    const onlineRows = await tx.$queryRawUnsafe<Array<{ online_since: Date | null }>>(
      `SELECT COALESCE(aa.online_since, aa.last_seen_at) AS online_since
       FROM agent_assignments aa
       WHERE aa.user_id = $1::uuid
         AND aa.status = 'online'
       LIMIT 1`,
      agentId,
    );

    const s = statsRows[0];
    return {
      total: toNumber(s?.total),
      resolved: toNumber(s?.resolved),
      avg_minutes: s?.avg_minutes ?? null,
      avg_csat: s?.avg_csat ?? null,
      sla_pct: s?.sla_pct ?? null,
      onlineSince: onlineRows[0]?.online_since?.toISOString() ?? null,
    };
  });
}

export async function getCsatDistribution(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
  await ensureMetricsInfrastructure(schemaName);

  return withTenantSchema(db, schemaName, async (tx) => {
    const where: string[] = ['csat_score IS NOT NULL'];
    const params: unknown[] = [];
    addCommonFilters(where, params, filters);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await tx.$queryRawUnsafe<Array<{ score: number; total: bigint }>>(
      `SELECT
         csat_score AS score,
         COUNT(*) AS total
       FROM conversations
       ${whereSql}
       GROUP BY csat_score
       ORDER BY csat_score ASC`,
      ...params,
    );

    return rows.map((row) => ({
      score: row.score,
      total: toNumber(row.total),
    }));
  });
}
