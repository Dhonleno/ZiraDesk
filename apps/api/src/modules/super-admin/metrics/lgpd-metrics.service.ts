import { prisma } from '../../../config/database.js';

interface TenantSchema {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
}

interface LgpdCountRow {
  total: bigint;
  pending: bigint;
  processed: bigint;
  rejected: bigint;
  breached: bigint;
  near_sla: bigint;
  avg_response_hours: number | null;
}

interface BreachedRow {
  id: string;
  subject_type: string;
  request_type: string;
  requested_at: Date;
  sla_deadline: Date | null;
}

interface NearSlaRow {
  id: string;
  subject_type: string;
  request_type: string;
  requested_at: Date;
  sla_deadline: Date | null;
}

export interface TenantLgpdMetrics {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  counts: {
    total: number;
    pending: number;
    processed: number;
    rejected: number;
    breached: number;
    near_sla: number;
  };
  avg_response_hours: number | null;
  breached_requests: Array<{
    id: string;
    subject_type: string;
    request_type: string;
    requested_at: Date;
    sla_deadline: Date | null;
    days_overdue: number;
  }>;
  near_sla_requests: Array<{
    id: string;
    subject_type: string;
    request_type: string;
    requested_at: Date;
    sla_deadline: Date | null;
    days_to_deadline: number;
  }>;
}

async function tableExists(schemaName: string): Promise<boolean> {
  const safe = schemaName.replace(/"/g, '""');
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'lgpd_requests'
     ) AS exists`,
    schemaName,
  );
  return rows[0]?.exists ?? false;
  void safe;
}

async function fetchTenantLgpdMetrics(tenant: TenantSchema): Promise<TenantLgpdMetrics> {
  const safe = tenant.schema_name.replace(/"/g, '""');

  const exists = await tableExists(tenant.schema_name);
  if (!exists) {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      counts: { total: 0, pending: 0, processed: 0, rejected: 0, breached: 0, near_sla: 0 },
      avg_response_hours: null,
      breached_requests: [],
      near_sla_requests: [],
    };
  }

  const [countsRows, breachedRows, nearSlaRows] = await Promise.all([
    prisma.$queryRawUnsafe<LgpdCountRow[]>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'processed') AS processed,
         COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
         COUNT(*) FILTER (WHERE status = 'pending' AND sla_deadline < NOW()) AS breached,
         COUNT(*) FILTER (WHERE status = 'pending' AND sla_deadline BETWEEN NOW() AND NOW() + INTERVAL '3 days') AS near_sla,
         AVG(EXTRACT(EPOCH FROM (processed_at - requested_at)) / 3600.0)
           FILTER (WHERE processed_at IS NOT NULL) AS avg_response_hours
       FROM "${safe}".lgpd_requests`,
    ),
    prisma.$queryRawUnsafe<BreachedRow[]>(
      `SELECT id, subject_type, request_type, requested_at, sla_deadline
       FROM "${safe}".lgpd_requests
       WHERE status = 'pending' AND sla_deadline < NOW()
       ORDER BY sla_deadline ASC
       LIMIT 50`,
    ),
    prisma.$queryRawUnsafe<NearSlaRow[]>(
      `SELECT id, subject_type, request_type, requested_at, sla_deadline
       FROM "${safe}".lgpd_requests
       WHERE status = 'pending'
         AND sla_deadline >= NOW()
         AND sla_deadline < NOW() + INTERVAL '3 days'
       ORDER BY sla_deadline ASC
       LIMIT 50`,
    ),
  ]);

  const counts = countsRows[0] ?? {
    total: 0n,
    pending: 0n,
    processed: 0n,
    rejected: 0n,
    breached: 0n,
    near_sla: 0n,
    avg_response_hours: null,
  };

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    counts: {
      total: Number(counts.total),
      pending: Number(counts.pending),
      processed: Number(counts.processed),
      rejected: Number(counts.rejected),
      breached: Number(counts.breached),
      near_sla: Number(counts.near_sla),
    },
    avg_response_hours: counts.avg_response_hours != null ? Number(counts.avg_response_hours.toFixed(1)) : null,
    breached_requests: breachedRows.map((r) => ({
      id: r.id,
      subject_type: r.subject_type,
      request_type: r.request_type,
      requested_at: r.requested_at,
      sla_deadline: r.sla_deadline,
      days_overdue: r.sla_deadline
        ? Math.ceil((Date.now() - r.sla_deadline.getTime()) / 86400_000)
        : 0,
    })),
    near_sla_requests: nearSlaRows.map((r) => ({
      id: r.id,
      subject_type: r.subject_type,
      request_type: r.request_type,
      requested_at: r.requested_at,
      sla_deadline: r.sla_deadline,
      days_to_deadline: r.sla_deadline
        ? Math.max(0, Math.ceil((r.sla_deadline.getTime() - Date.now()) / 86400_000))
        : 0,
    })),
  };
}

export async function getLgpdMetrics(): Promise<{
  tenants: TenantLgpdMetrics[];
  summary: {
    total_tenants: number;
    tenants_with_pending: number;
    tenants_with_breaches: number;
    global_pending: number;
    global_breached: number;
    global_near_sla: number;
  };
}> {
  const tenants = await prisma.$queryRawUnsafe<TenantSchema[]>(
    `SELECT id, name, slug, schema_name
     FROM tenants
     WHERE status IN ('active', 'trial')
     ORDER BY name`,
  );

  const metrics = await Promise.all(tenants.map(fetchTenantLgpdMetrics));

  return {
    tenants: metrics,
    summary: {
      total_tenants: metrics.length,
      tenants_with_pending: metrics.filter((m) => m.counts.pending > 0).length,
      tenants_with_breaches: metrics.filter((m) => m.counts.breached > 0).length,
      global_pending: metrics.reduce((sum, m) => sum + m.counts.pending, 0),
      global_breached: metrics.reduce((sum, m) => sum + m.counts.breached, 0),
      global_near_sla: metrics.reduce((sum, m) => sum + m.counts.near_sla, 0),
    },
  };
}
