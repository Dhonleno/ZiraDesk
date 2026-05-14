import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.js';
import { hasRole } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { prisma } from '../../config/database.js';
import { getTicketsMetrics } from './tickets-metrics.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent')];

const ticketsMetricsQuerySchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  date_to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  agent_id:  z.string().uuid().optional(),
  category:  z.string().min(1).optional(),
});

function buildUtcDate(year: number, month: number, day: number, h = 0, m = 0, s = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, h, m, s, 0));
}

function parseDateParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)!;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

async function resolveSchemaName(request: { user: { tenantId?: string; schemaName?: string } }): Promise<string> {
  if (request.user.schemaName) return request.user.schemaName;
  const tenantId = request.user.tenantId;
  if (!tenantId) throw new Error('Tenant não identificado');
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  if (!tenant) throw new Error('Tenant não encontrado');
  return tenant.schemaName;
}

export async function ticketsMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', { preHandler: guard }, async (request, reply) => {
    const parsed = ticketsMetricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const { date_from, date_to, agent_id, category } = parsed.data;

    const fromParts = parseDateParts(date_from);
    const toParts   = parseDateParts(date_to);
    const dateFrom  = buildUtcDate(fromParts.year, fromParts.month, fromParts.day, 0, 0, 0);
    const dateTo    = buildUtcDate(toParts.year,   toParts.month,   toParts.day,   23, 59, 59);

    if (dateFrom > dateTo) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Período inválido: date_from maior que date_to' },
      });
    }

    const dateToExclusive = new Date(
      buildUtcDate(toParts.year, toParts.month, toParts.day).getTime() + 24 * 60 * 60 * 1000,
    );

    try {
      const schemaName = await resolveSchemaName(request);
      const metricsFilters: import('./tickets-metrics.service.js').TicketsMetricsFilters = {
        dateFrom,
        dateToExclusive,
        ...(agent_id ? { agentId: agent_id } : {}),
        ...(category ? { category } : {}),
      };
      const data = await getTicketsMetrics(metricsFilters, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas de tickets' },
      });
    }
  });
}
