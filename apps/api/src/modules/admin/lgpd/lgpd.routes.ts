import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { ensureCrmInfrastructureMiddleware } from '../../crm/crm.infrastructure.js';
import { prisma } from '../../../config/database.js';
import { notifySubjectRequestProcessed } from '../../../lib/lgpd/sla.service.js';

const guard = [
  authMiddleware,
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
  requirePermission('lgpd:manage'),
];

const processRequestBodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().max(1000).optional(),
});

interface DashboardRow {
  total_pending: bigint;
  expiring_7d: bigint;
  expiring_24h: bigint;
  breached: bigint;
}

interface OldestPendingRow {
  id: string;
  subject_type: string;
  request_type: string;
  status: string;
  requested_at: Date;
  sla_deadline: Date | null;
  contact_name: string | null;
  user_name: string | null;
}

interface ProcessableRequest {
  id: string;
  subject_type: string;
  request_type: string;
  status: string;
  contact_email: string | null;
  user_email: string | null;
}

export async function adminLgpdRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/lgpd/dashboard
  app.get('/dashboard', { preHandler: guard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const safe = schemaName.replace(/"/g, '""');

    const [countsRows, oldest] = await Promise.all([
      prisma.$queryRawUnsafe<DashboardRow[]>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending') AS total_pending,
           COUNT(*) FILTER (WHERE status = 'pending' AND sla_deadline <= NOW() + INTERVAL '7 days' AND sla_deadline > NOW()) AS expiring_7d,
           COUNT(*) FILTER (WHERE status = 'pending' AND sla_deadline <= NOW() + INTERVAL '1 day' AND sla_deadline > NOW()) AS expiring_24h,
           COUNT(*) FILTER (WHERE status = 'pending' AND sla_deadline < NOW()) AS breached
         FROM "${safe}".lgpd_requests`,
      ),
      prisma.$queryRawUnsafe<OldestPendingRow[]>(
        `SELECT
           lr.id, lr.subject_type, lr.request_type, lr.status,
           lr.requested_at, lr.sla_deadline,
           c.name AS contact_name,
           u.name AS user_name
         FROM "${safe}".lgpd_requests lr
         LEFT JOIN "${safe}".contacts c ON c.id = lr.contact_id
         LEFT JOIN "${safe}".users u ON u.id = lr.user_id
         WHERE lr.status = 'pending'
         ORDER BY lr.requested_at ASC
         LIMIT 10`,
      ),
    ]);

    const counts = countsRows[0] ?? { total_pending: 0n, expiring_7d: 0n, expiring_24h: 0n, breached: 0n };

    return reply.send({
      success: true,
      data: {
        total_pending: Number(counts.total_pending),
        expiring_7d: Number(counts.expiring_7d),
        expiring_24h: Number(counts.expiring_24h),
        breached: Number(counts.breached),
        oldest_pending: oldest.map((row) => ({
          ...row,
          subject_label: row.contact_name ?? row.user_name ?? 'ID externo',
        })),
      },
    });
  });

  // PATCH /api/admin/lgpd/requests/:id
  app.patch('/requests/:id', { preHandler: guard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = processRequestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const safe = schemaName.replace(/"/g, '""');
    const { action, notes } = parsed.data;
    const newStatus = action === 'approve' ? 'processed' : 'rejected';

    const rows = await prisma.$queryRawUnsafe<ProcessableRequest[]>(
      `SELECT
         lr.id, lr.subject_type, lr.request_type, lr.status,
         c.email AS contact_email,
         u.email AS user_email
       FROM "${safe}".lgpd_requests lr
       LEFT JOIN "${safe}".contacts c ON c.id = lr.contact_id
       LEFT JOIN "${safe}".users u ON u.id = lr.user_id
       WHERE lr.id = $1::uuid`,
      id,
    );

    const req = rows[0];
    if (!req) {
      return reply.code(404).send({ success: false, error: { message: 'Solicitação não encontrada' } });
    }
    if (req.status !== 'pending') {
      return reply.code(409).send({ success: false, error: { message: 'Solicitação já foi processada' } });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "${safe}".lgpd_requests
       SET status = $1,
           processed_at = NOW(),
           processed_by = $2::uuid,
           result = result || $3::jsonb
       WHERE id = $4::uuid`,
      newStatus,
      request.user.id,
      JSON.stringify({ action, notes: notes ?? null, processed_by_name: request.user.name }),
      id,
    );

    // Notify data subject if approved
    if (action === 'approve') {
      const tenantRows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; settings: unknown }>>(
        `SELECT id, name, settings FROM tenants WHERE schema_name = $1`,
        schemaName,
      );
      const tenant = tenantRows[0];
      if (tenant) {
        const subjectEmail = req.contact_email ?? req.user_email;
        const notifyParams: Parameters<typeof notifySubjectRequestProcessed>[0] = {
          tenant: { id: tenant.id, name: tenant.name, schema_name: schemaName, settings: tenant.settings },
          schemaName,
          requestId: id,
          requestType: req.request_type,
          processedAt: new Date(),
          subjectEmail,
        };
        if (notes !== undefined) notifyParams.notes = notes;
        await notifySubjectRequestProcessed(notifyParams).catch(() => {});
      }
    }

    return reply.send({ success: true, data: { id, status: newStatus } });
  });
}
