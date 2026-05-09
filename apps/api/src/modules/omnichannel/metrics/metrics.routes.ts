import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { prisma } from '../../../config/database.js';
import {
  getByAgent,
  getByChannel,
  getByDepartment,
  getCsatDistribution,
  getMyStats,
  getOverview,
  getPeakHours,
  getVolumeByPeriod,
} from './metrics.service.js';

const guard = [authMiddleware, hasRole('owner', 'admin', 'agent'), tenantSchemaFromJwt];

const metricsQuerySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  agent_id: z.string().uuid().optional(),
  channel_type: z.string().optional(),
  department: z.string().optional(),
});

function parseDatePartsOrNull(value: string | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function buildUtcDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
}

function startOfUtcDay(date: Date): Date {
  return buildUtcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, 0, 0, 0);
}

function nextUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + 24 * 60 * 60 * 1000);
}

function getDefaultDateFrom(): Date {
  const now = new Date();
  const start = startOfUtcDay(now);
  return new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
}

function resolveSchemaNameFromRequest(request: { user: { tenantId?: string; schemaName?: string } }) {
  return async (): Promise<string> => {
    if (request.user.schemaName) return request.user.schemaName;
    const tenantId = request.user.tenantId;
    if (!tenantId) throw new Error('Tenant não identificado');
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });
    if (!tenant) throw new Error('Tenant não encontrado');
    return tenant.schemaName;
  };
}

function getFilters(raw: z.infer<typeof metricsQuerySchema>) {
  const dateFromParts = parseDatePartsOrNull(raw.date_from);
  const dateToParts = parseDatePartsOrNull(raw.date_to);

  const dateFrom = dateFromParts
    ? buildUtcDate(dateFromParts.year, dateFromParts.month, dateFromParts.day, 0, 0, 0, 0)
    : getDefaultDateFrom();
  const dateTo = dateToParts
    ? buildUtcDate(dateToParts.year, dateToParts.month, dateToParts.day, 23, 59, 59, 999)
    : new Date();
  const dateToExclusive = dateToParts
    ? buildUtcDate(dateToParts.year, dateToParts.month, dateToParts.day + 1, 0, 0, 0, 0)
    : nextUtcDay(dateTo);

  if (dateFrom > dateTo) {
    throw new Error('Período inválido: date_from maior que date_to');
  }

  return {
    dateFrom,
    dateTo,
    dateToExclusive,
    ...(raw.agent_id ? { agentId: raw.agent_id } : {}),
    ...(raw.channel_type ? { channelType: raw.channel_type } : {}),
    ...(raw.department ? { department: raw.department } : {}),
  };
}

export async function omnichannelMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics/me', { preHandler: guard }, async (request, reply) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = await resolveSchemaNameFromRequest(request)();
      const data = await getMyStats(request.user.id, getFilters(parsed.data), schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas' },
      });
    }
  });

  app.get('/metrics/overview', { preHandler: guard }, async (request, reply) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = await resolveSchemaNameFromRequest(request)();
      const data = await getOverview(getFilters(parsed.data), schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas' },
      });
    }
  });

  app.get('/metrics/volume', { preHandler: guard }, async (request, reply) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = await resolveSchemaNameFromRequest(request)();
      const data = await getVolumeByPeriod(getFilters(parsed.data), schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas' },
      });
    }
  });

  app.get('/metrics/by-agent', { preHandler: guard }, async (request, reply) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = await resolveSchemaNameFromRequest(request)();
      const data = await getByAgent(getFilters(parsed.data), schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas' },
      });
    }
  });

  app.get('/metrics/by-channel', { preHandler: guard }, async (request, reply) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = await resolveSchemaNameFromRequest(request)();
      const data = await getByChannel(getFilters(parsed.data), schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas' },
      });
    }
  });

  app.get('/metrics/by-department', { preHandler: guard }, async (request, reply) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = await resolveSchemaNameFromRequest(request)();
      const data = await getByDepartment(getFilters(parsed.data), schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas' },
      });
    }
  });

  app.get('/metrics/peak-hours', { preHandler: guard }, async (request, reply) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = await resolveSchemaNameFromRequest(request)();
      const data = await getPeakHours(getFilters(parsed.data), schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas' },
      });
    }
  });

  app.get('/metrics/csat', { preHandler: guard }, async (request, reply) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = await resolveSchemaNameFromRequest(request)();
      const data = await getCsatDistribution(getFilters(parsed.data), schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao carregar métricas' },
      });
    }
  });
}
