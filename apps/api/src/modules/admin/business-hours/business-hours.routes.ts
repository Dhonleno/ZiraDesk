import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { prisma } from '../../../config/database.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  importNationalHolidaysSchema,
  updateBusinessHoursSchema,
} from './business-hours.schema.js';
import {
  ensureBusinessHoursInfrastructure,
  getBusinessHours,
  getBusinessHoursStatus,
  repairZeroedLegacyShifts,
  updateBusinessHours,
} from './business-hours.service.js';
import { seedNationalHolidays } from '../../../database/seeds/holidays.seed.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function businessHoursRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const tenantUser = request.user as AuthUser;
    const schemaName = tenantUser.schemaName ?? null;
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const data = await getBusinessHours(schemaName);
    return reply.send({ success: true, data });
  });

  app.get('/status', { preHandler: guard }, async (request, reply) => {
    const tenantUser = request.user as AuthUser;
    const schemaName = tenantUser.schemaName ?? null;
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: request.user.tenantId! },
      select: { settings: true },
    });
    const settings = (tenant?.settings as Record<string, unknown>) ?? {};
    const timezone = (settings.timezone as string | undefined) ?? 'America/Sao_Paulo';
    const data = await getBusinessHoursStatus(timezone, prisma, schemaName);
    return reply.send({ success: true, data });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const tenantUser = request.user as AuthUser;
    const schemaName = tenantUser.schemaName ?? null;
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = updateBusinessHoursSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const data = await updateBusinessHours(parsed.data, schemaName);
    return reply.send({ success: true, data });
  });

  app.post('/holidays/import', { preHandler: guard }, async (request, reply) => {
    const parsed = importNationalHolidaysSchema.safeParse(request.body);
    const tenantUser = request.user as AuthUser;
    const schemaName = tenantUser.schemaName ?? null;
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    await ensureBusinessHoursInfrastructure(prisma, schemaName);
    const imported = await seedNationalHolidays(prisma, schemaName, parsed.data.country);
    return reply.send({ success: true, data: { imported } });
  });

  app.post('/repair-legacy-shifts', { preHandler: guard }, async (request, reply) => {
    const tenantUser = request.user as AuthUser;
    const schemaName = tenantUser.schemaName ?? null;
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const updated = await repairZeroedLegacyShifts(prisma, schemaName);
    return reply.send({ success: true, data: { updated } });
  });
}
