import { prisma } from '../../config/database.js';

export interface TicketsMetricsFilters {
  dateFrom: Date;
  dateToExclusive: Date;
  agentId?: string;
  category?: string;
}

interface OverviewRow {
  total: bigint;
  open: bigint;
  in_progress: bigint;
  waiting: bigint;
  resolved: bigint;
  closed: bigint;
  avg_resolution_minutes: number | null;
}

interface PeriodRow {
  date: string;
  opened: bigint;
  resolved: bigint;
}

interface AgentRow {
  agent_id: string;
  agent_name: string | null;
  total: bigint;
  resolved: bigint;
  avg_resolution_minutes: number | null;
  open_now: bigint;
}

interface CategoryRow {
  category: string;
  count: bigint;
}

interface TypeRow {
  type: string;
  count: bigint;
}

function toSafeSchema(schemaName: string): string {
  return schemaName.replace(/"/g, '""');
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function toPercentage(count: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

async function withTenantSchema<T>(
  schemaName: string,
  runner: (tx: typeof prisma) => Promise<T>,
): Promise<T> {
  const safe = toSafeSchema(schemaName);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safe}", public`);
    return runner(tx as typeof prisma);
  });
}

function buildCommonWhere(
  params: unknown[],
  filters: TicketsMetricsFilters,
  alias = 't',
): string {
  const p = alias ? `${alias}.` : '';
  params.push(filters.dateFrom);
  const fromIdx = params.length;
  params.push(filters.dateToExclusive);
  const toIdx = params.length;

  const clauses = [
    `${p}created_at >= $${fromIdx}::timestamptz`,
    `${p}created_at < $${toIdx}::timestamptz`,
  ];

  if (filters.agentId) {
    params.push(filters.agentId);
    clauses.push(`${p}assigned_to = $${params.length}::uuid`);
  }

  if (filters.category) {
    params.push(filters.category);
    clauses.push(`${p}category = $${params.length}::text`);
  }

  return clauses.join(' AND ');
}

export async function getTicketsMetrics(filters: TicketsMetricsFilters, schemaName: string) {
  return withTenantSchema(schemaName, async (tx) => {
    // ── Overview ────────────────────────────────────────────────────────────
    const overviewParams: unknown[] = [];
    const overviewWhere = buildCommonWhere(overviewParams, filters);

    const [overviewRow] = await tx.$queryRawUnsafe<OverviewRow[]>(
      `SELECT
         COUNT(*)                                                              AS total,
         COUNT(*) FILTER (WHERE status = 'open')                              AS open,
         COUNT(*) FILTER (WHERE status = 'in_progress')                       AS in_progress,
         COUNT(*) FILTER (WHERE status = 'waiting')                           AS waiting,
         COUNT(*) FILTER (WHERE status = 'resolved')                          AS resolved,
         COUNT(*) FILTER (WHERE status = 'closed')                            AS closed,
         ROUND(
           AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60)
             FILTER (WHERE resolved_at IS NOT NULL)
         )::integer                                                            AS avg_resolution_minutes
       FROM tickets t
       WHERE ${overviewWhere}`,
      ...overviewParams,
    );

    // ── By Period ────────────────────────────────────────────────────────────
    const periodParams: unknown[] = [];
    const periodWhere = buildCommonWhere(periodParams, filters);

    // resolved filter uses same date window on resolved_at
    const resolvedParams: unknown[] = [];
    resolvedParams.push(filters.dateFrom);
    const rfIdx = resolvedParams.length;
    resolvedParams.push(filters.dateToExclusive);
    const rtIdx = resolvedParams.length;
    if (filters.agentId) {
      resolvedParams.push(filters.agentId);
    }
    if (filters.category) {
      resolvedParams.push(filters.category);
    }
    const resolvedExtraClauses: string[] = [];
    let resolvedParamIdx = 3;
    if (filters.agentId) {
      resolvedExtraClauses.push(`assigned_to = $${resolvedParamIdx}::uuid`);
      resolvedParamIdx++;
    }
    if (filters.category) {
      resolvedExtraClauses.push(`category = $${resolvedParamIdx}::text`);
    }
    const resolvedExtra = resolvedExtraClauses.length ? ` AND ${resolvedExtraClauses.join(' AND ')}` : '';

    const periodRows = await tx.$queryRawUnsafe<PeriodRow[]>(
      `WITH
         opened AS (
           SELECT date_trunc('day', t.created_at AT TIME ZONE 'UTC')::date AS date,
                  COUNT(*) AS cnt
           FROM tickets t
           WHERE ${periodWhere}
           GROUP BY 1
         ),
         resolved AS (
           SELECT date_trunc('day', resolved_at AT TIME ZONE 'UTC')::date AS date,
                  COUNT(*) AS cnt
           FROM tickets
           WHERE resolved_at >= $${rfIdx}::timestamptz
             AND resolved_at < $${rtIdx}::timestamptz
             ${resolvedExtra}
           GROUP BY 1
         ),
         dates AS (
           SELECT generate_series(
             date_trunc('day', $1::timestamptz AT TIME ZONE 'UTC')::date,
             date_trunc('day', ($2::timestamptz - interval '1 second') AT TIME ZONE 'UTC')::date,
             '1 day'::interval
           )::date AS date
         )
       SELECT
         to_char(d.date, 'YYYY-MM-DD') AS date,
         COALESCE(o.cnt, 0)            AS opened,
         COALESCE(r.cnt, 0)            AS resolved
       FROM dates d
       LEFT JOIN opened   o ON o.date = d.date
       LEFT JOIN resolved r ON r.date = d.date
       ORDER BY d.date`,
      ...periodParams,
    );

    // ── By Agent ─────────────────────────────────────────────────────────────
    const agentParams: unknown[] = [];
    const agentWhere = buildCommonWhere(agentParams, filters);

    const agentRows = await tx.$queryRawUnsafe<AgentRow[]>(
      `SELECT
         t.assigned_to                                                         AS agent_id,
         u.name                                                                AS agent_name,
         COUNT(*)                                                              AS total,
         COUNT(*) FILTER (WHERE t.status IN ('resolved', 'closed'))           AS resolved,
         ROUND(
           AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 60)
             FILTER (WHERE t.resolved_at IS NOT NULL)
         )::integer                                                            AS avg_resolution_minutes,
         COUNT(*) FILTER (WHERE t.status NOT IN ('resolved', 'closed'))       AS open_now
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.assigned_to IS NOT NULL
         AND ${agentWhere}
       GROUP BY t.assigned_to, u.name
       ORDER BY total DESC`,
      ...agentParams,
    );

    // ── By Category ──────────────────────────────────────────────────────────
    const catParams: unknown[] = [];
    const catWhere = buildCommonWhere(catParams, filters);

    const categoryRows = await tx.$queryRawUnsafe<CategoryRow[]>(
      `SELECT
         COALESCE(category, 'Sem categoria') AS category,
         COUNT(*)                            AS count
       FROM tickets t
       WHERE ${catWhere}
         AND category IS NOT NULL
       GROUP BY category
       ORDER BY count DESC`,
      ...catParams,
    );

    // ── By Type ──────────────────────────────────────────────────────────────
    const typeParams: unknown[] = [];
    const typeWhere = buildCommonWhere(typeParams, filters);

    const typeRows = await tx.$queryRawUnsafe<TypeRow[]>(
      `SELECT
         COALESCE(tt.name, 'Sem tipo') AS type,
         COUNT(*)                      AS count
       FROM tickets t
       LEFT JOIN ticket_types tt ON tt.id = t.type_id
       WHERE ${typeWhere}
       GROUP BY tt.name
       ORDER BY count DESC`,
      ...typeParams,
    );

    // ── Assemble ─────────────────────────────────────────────────────────────
    const totalCount = toNumber(overviewRow?.total);
    const catTotal = categoryRows.reduce((acc, r) => acc + toNumber(r.count), 0);
    const typeTotal = typeRows.reduce((acc, r) => acc + toNumber(r.count), 0);

    return {
      overview: {
        total:                  totalCount,
        open:                   toNumber(overviewRow?.open),
        inProgress:             toNumber(overviewRow?.in_progress),
        waiting:                toNumber(overviewRow?.waiting),
        resolved:               toNumber(overviewRow?.resolved),
        closed:                 toNumber(overviewRow?.closed),
        avgResolutionMinutes:   toNumber(overviewRow?.avg_resolution_minutes),
      },
      byPeriod: periodRows.map((r) => ({
        date:     r.date,
        opened:   toNumber(r.opened),
        resolved: toNumber(r.resolved),
      })),
      byAgent: agentRows.map((r) => ({
        agentId:              r.agent_id,
        agentName:            r.agent_name ?? 'Agente removido',
        total:                toNumber(r.total),
        resolved:             toNumber(r.resolved),
        avgResolutionMinutes: toNumber(r.avg_resolution_minutes),
        openNow:              toNumber(r.open_now),
      })),
      byCategory: categoryRows.map((r) => ({
        category:   r.category,
        count:      toNumber(r.count),
        percentage: toPercentage(toNumber(r.count), catTotal),
      })),
      byType: typeRows.map((r) => ({
        type:       r.type,
        count:      toNumber(r.count),
        percentage: toPercentage(toNumber(r.count), typeTotal),
      })),
    };
  });
}
