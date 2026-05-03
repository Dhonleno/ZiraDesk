import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }
    const data = await listNotifications(request.user.id, schemaName);
    return reply.send({ success: true, data });
  });

  app.patch<{ Params: { id: string } }>('/:id/read', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }
    const data = await markNotificationRead(request.user.id, request.params.id, schemaName);
    return reply.send({ success: true, data });
  });

  app.patch('/read-all', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }
    const data = await markAllNotificationsRead(request.user.id, schemaName);
    return reply.send({ success: true, data });
  });
}
