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

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function parseDateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getDefaultDateFrom(): Date {
  const now = new Date();
  now.setDate(now.getDate() - 7);
  return startOfDay(now);
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
  const dateFromRaw = parseDateOrNull(raw.date_from);
  const dateToRaw = parseDateOrNull(raw.date_to);

  const dateFrom = dateFromRaw ? startOfDay(dateFromRaw) : getDefaultDateFrom();
  const dateTo = dateToRaw ? endOfDay(dateToRaw) : endOfDay(new Date());

  if (dateFrom > dateTo) {
    throw new Error('Período inválido: date_from maior que date_to');
  }

  return {
    dateFrom,
    dateTo,
    ...(raw.agent_id ? { agentId: raw.agent_id } : {}),
    ...(raw.channel_type ? { channelType: raw.channel_type } : {}),
    ...(raw.department ? { department: raw.department } : {}),
  };
}

export async function omnichannelMetricsRoutes(app: FastifyInstance): Promise<void> {
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

