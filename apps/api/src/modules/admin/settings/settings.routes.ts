import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { updateSettingsSchema } from './settings.schema.js';
import { getSettings, updateSettings } from './settings.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const data = await getSettings(request.user.tenantId!);
    return reply.send({ success: true, data });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    const data = await updateSettings(request.user.tenantId!, parsed.data);
    return reply.send({ success: true, data });
  });
}
