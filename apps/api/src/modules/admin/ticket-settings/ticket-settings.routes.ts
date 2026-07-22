import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { updateTicketSettingsSchema } from './ticket-settings.schema.js';
import { getSettings, updateSettings } from '../settings/settings.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function ticketSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const data = await getSettings(request.user.tenantId!);
    return reply.send({
      success: true,
      data: {
        ticket_auto_assign: data.ticket_auto_assign,
      },
    });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const parsed = updateTicketSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    const data = await updateSettings(request.user.tenantId!, parsed.data);
    return reply.send({
      success: true,
      data: {
        ticket_auto_assign: data.ticket_auto_assign,
      },
    });
  });
}
