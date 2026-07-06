import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import {
  deleteAllReadNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markConversationNotificationsRead,
  markNotificationRead,
} from './notifications.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string | number; per_page?: string | number } }>(
    '/',
    { preHandler: guard },
    async (request, reply) => {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      if (!schemaName) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Schema do tenant nao identificado' },
        });
      }
      const page = parsePositiveInt(request.query.page, 1);
      const perPage = parsePositiveInt(request.query.per_page, 20);
      const result = await listNotifications(request.user.id, schemaName, page, perPage);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  app.patch<{ Params: { conversationId: string } }>(
    '/conversations/:conversationId/read',
    { preHandler: guard },
    async (request, reply) => {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      if (!schemaName) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Schema do tenant nao identificado' },
        });
      }
      const data = await markConversationNotificationsRead(
        request.user.id,
        request.params.conversationId,
        schemaName,
      );
      return reply.send({ success: true, data });
    },
  );

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

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }
    const data = await deleteNotification(request.user.id, request.params.id, schemaName);
    return reply.send({ success: true, data });
  });

  app.delete('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }
    const data = await deleteAllReadNotifications(request.user.id, schemaName);
    return reply.send({ success: true, data });
  });
}
