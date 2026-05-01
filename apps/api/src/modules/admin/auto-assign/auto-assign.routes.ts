import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  getConfig,
  resetRoundRobin,
  toggleAgentAvailability,
  updateConfig,
  NotFoundError,
} from './auto-assign.service.js';
import {
  toggleAgentAvailabilitySchema,
  updateAutoAssignConfigSchema,
} from './auto-assign.schema.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function autoAssignRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await getConfig(request.user.tenantId!, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const parsed = updateAutoAssignConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const settings = await updateConfig(request.user.tenantId!, parsed.data);
      return reply.send({ success: true, data: settings });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch<{ Params: { userId: string } }>('/agents/:userId', { preHandler: guard }, async (request, reply) => {
    const parsed = toggleAgentAvailabilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await toggleAgentAvailability(
        request.user.tenantId!,
        request.params.userId,
        parsed.data,
        schemaName,
      );
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post('/reset', { preHandler: guard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      await resetRoundRobin(request.user.tenantId!, schemaName);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
