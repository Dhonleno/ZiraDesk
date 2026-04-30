import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../config/database.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  businessHourDayParamSchema,
  updateBusinessHourSchema,
} from './business-hours.schema.js';
import {
  getBusinessHours,
  getBusinessHoursStatus,
  updateBusinessHour,
} from './business-hours.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function businessHoursRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (_request, reply) => {
    const data = await getBusinessHours();
    return reply.send({ success: true, data });
  });

  app.get('/status', { preHandler: guard }, async (request, reply) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: request.user.tenantId! },
      select: { settings: true },
    });
    const settings = (tenant?.settings as Record<string, unknown>) ?? {};
    const timezone = (settings.timezone as string | undefined) ?? 'America/Sao_Paulo';
    const data = await getBusinessHoursStatus(timezone);
    return reply.send({ success: true, data });
  });

  app.patch<{ Params: { day: string } }>('/:day', { preHandler: guard }, async (request, reply) => {
    const params = businessHourDayParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dia inválido', details: params.error.flatten() },
      });
    }

    const parsed = updateBusinessHourSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const data = await updateBusinessHour(params.data.day, parsed.data);
    return reply.send({ success: true, data });
  });
}
