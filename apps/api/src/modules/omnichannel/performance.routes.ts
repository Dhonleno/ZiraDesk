import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { resolveTenantTimezone } from './history/history.service.js';
import { performanceQuerySchema } from './performance.schema.js';
import {
  exportPerformanceCsv,
  listPerformance,
  listPerformanceByGroup,
  resolvePerformanceSchema,
} from './performance.service.js';

export async function omnichannelPerformanceRoutes(app: FastifyInstance): Promise<void> {
  const guard = [authMiddleware, tenantSchemaFromJwt, requirePermission('metrics:view')];

  app.get('/performance', { preHandler: guard }, async (request, reply) => {
    const parsed = performanceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const schemaName = await resolvePerformanceSchema(request.user.tenantId);
    if (!schemaName) {
      return reply.send({
        success: true,
        data: [],
        meta: { total: 0, page: parsed.data.page, perPage: parsed.data.per_page, totalPages: 0 },
        team_kpis: {
          avg_tma_minutes: null,
          avg_tme_minutes: null,
          avg_csat: null,
          sla_percent: null,
          total_volume: 0,
        },
      });
    }

    try {
      const timezone = await resolveTenantTimezone(request.user.tenantId);
      const result = await listPerformance(schemaName, parsed.data, timezone);

      if (parsed.data.export === 'csv') {
        const csv = exportPerformanceCsv(result.data);
        const fileDate = new Date().toISOString().slice(0, 10);
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="performance-${fileDate}.csv"`)
          .send(`\uFEFF${csv}`);
      }

      return reply.send({ success: true, ...result });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar performance' },
      });
    }
  });

  app.get('/performance/by-group', { preHandler: guard }, async (request, reply) => {
    const parsed = performanceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inv\u00E1lida', details: parsed.error.flatten() },
      });
    }

    const schemaName = await resolvePerformanceSchema(request.user.tenantId);
    if (!schemaName) {
      return reply.send({ success: true, data: [], applied_filters: parsed.data });
    }

    try {
      const timezone = await resolveTenantTimezone(request.user.tenantId);
      const result = await listPerformanceByGroup(schemaName, parsed.data, timezone);
      return reply.send({ success: true, ...result });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar performance por grupo' },
      });
    }
  });
}
