import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { updateQueueConfigSchema } from './queue-config.schema.js';
import { getSettings, updateSettings } from '../settings/settings.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function queueConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const data = await getSettings(request.user.tenantId!);
    return reply.send({
      success: true,
      data: {
        queue_notifications_enabled: data.queue_notifications_enabled,
        queue_message_template: data.queue_message_template,
        queue_throttle_seconds: data.queue_throttle_seconds,
        agent_assume_template: data.agent_assume_template,
        expire_24h_action: data.expire_24h_action,
        expire_24h_message: data.expire_24h_message,
      },
    });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const parsed = updateQueueConfigSchema.safeParse(request.body);
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
        queue_notifications_enabled: data.queue_notifications_enabled,
        queue_message_template: data.queue_message_template,
        queue_throttle_seconds: data.queue_throttle_seconds,
        agent_assume_template: data.agent_assume_template,
        expire_24h_action: data.expire_24h_action,
        expire_24h_message: data.expire_24h_message,
      },
    });
  });
}
