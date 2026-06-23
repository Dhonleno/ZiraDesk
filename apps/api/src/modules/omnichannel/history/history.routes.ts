import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { historyDetailParamsSchema, historyQuerySchema } from './history.schema.js';
import { exportHistoryCsv, getHistoryDetail, listHistory, resolveTenantTimezone } from './history.service.js';

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
  period: 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom',
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
    return {
      dateFromLocal: `${today.slice(0, 8)}01`,
      dateToLocal: today,
    };
  }

  const days = period === '30d' ? 30 : 7;
  return {
    dateFromLocal: addDaysToIsoDate(today, -days),
    dateToLocal: today,
  };
}

export async function omnichannelHistoryRoutes(app: FastifyInstance): Promise<void> {
  const guard = [authMiddleware, tenantSchemaFromJwt, requirePermission('metrics:view')];

  // GET /api/omnichannel/history
  app.get('/history', { preHandler: guard }, async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const timezone = await resolveTenantTimezone(request.user.tenantId);
    const { dateFromLocal, dateToLocal } = resolveDateRange(
      parsed.data.period,
      timezone,
      parsed.data.date_from,
      parsed.data.date_to,
    );

    if (dateFromLocal > dateToLocal) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Período inválido: date_from maior que date_to' },
      });
    }

    const baseFilters = {
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.assigned_to ? { assignedTo: parsed.data.assigned_to } : {}),
      ...(parsed.data.channel_type ? { channelType: parsed.data.channel_type } : {}),
      ...(parsed.data.bot_option_id ? { botOptionId: parsed.data.bot_option_id } : {}),
      ...(parsed.data.csat_rating ? { csatRating: parsed.data.csat_rating } : {}),
      dateFromLocal,
      dateToLocal,
      timezone,
      sortBy: parsed.data.sort_by,
      sortOrder: parsed.data.sort_order,
    };

    if (parsed.data.export === 'csv') {
      const csv = await exportHistoryCsv(baseFilters, request.user.tenantId);
      const fileDate = new Date().toISOString().slice(0, 10);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="historico-${fileDate}.csv"`)
        .send(`\uFEFF${csv}`);
    }

    const result = await listHistory(
      {
        page: parsed.data.page,
        perPage: parsed.data.per_page,
        ...baseFilters,
      },
      request.user.tenantId,
    );

    return reply.send({
      success: true,
      ...result,
      applied_filters: {
        ...parsed.data,
        date_from: dateFromLocal,
        date_to: dateToLocal,
        timezone,
      },
    });
  });

  // GET /api/omnichannel/history/:conversationId
  app.get<{ Params: { conversationId: string } }>('/history/:conversationId', { preHandler: guard }, async (request, reply) => {
    const parsed = historyDetailParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Parâmetros inválidos', details: parsed.error.flatten() },
      });
    }

    const data = await getHistoryDetail(parsed.data.conversationId, request.user.tenantId);
    if (!data) {
      return reply.code(404).send({
        success: false,
        error: { message: 'Atendimento não encontrado' },
      });
    }

    return reply.send({ success: true, data });
  });
}
