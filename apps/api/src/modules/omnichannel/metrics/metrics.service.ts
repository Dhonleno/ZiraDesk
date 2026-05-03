import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../../config/database.js';

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

function toSafeSchema(schemaName: string): string {
  return schemaName.replace(/"/g, '""');
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

export async function getOverview(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
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
         ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60))::integer AS avg_minutes
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
           AVG(EXTRACT(EPOCH FROM (first_agent_message_at - created_at)) / 60)
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
    };
  });
}

export async function getVolumeByPeriod(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
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
         ROUND(AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 60))::integer AS avg_minutes,
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

export async function getCsatDistribution(filters: MetricsFilters, schemaName: string, db: MetricsDbClient = prisma) {
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
