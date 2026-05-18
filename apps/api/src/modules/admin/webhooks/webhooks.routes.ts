import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { createWebhookSchema, updateWebhookSchema } from './webhooks.schema.js';
import {
  NotFoundError,
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  updateWebhook,
} from './webhooks.service.js';
import { fireWebhook } from '../../../services/webhook-dispatcher.js';

const adminGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

function getSchemaName(request: { user: { schemaName?: string } }): string {
  const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
  if (!schemaName) throw new Error('schemaName ausente no token');
  return schemaName;
}

export async function webhooksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await listWebhooks(schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      throw err;
    }
  });

  app.post('/', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = createWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
    const data = await createWebhook(schemaName, parsed.data);
    return reply.code(201).send({ success: true, data });
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await getWebhook(schemaName, request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = updateWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await updateWebhook(schemaName, request.params.id, parsed.data);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await deleteWebhook(schemaName, request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/test', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const webhook = await getWebhook(schemaName, request.params.id);

      const tenantId = (request.user as { tenantId?: string }).tenantId ?? '';
      const testPayload = JSON.stringify({
        event: 'webhook.test',
        timestamp: new Date().toISOString(),
        tenantId,
        data: { message: 'Webhook de teste do ZiraDesk' },
      });

      const result = await fireWebhook(
        { id: webhook.id, url: webhook.url, secret: webhook.secret, headers: webhook.headers },
        testPayload,
      );

      return reply.send({ success: true, data: { status: result.status } });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
