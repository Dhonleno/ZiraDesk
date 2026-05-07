import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  createCloseOutcomeSchema,
  createCloseTypeSchema,
  reorderCloseConfigSchema,
  updateCloseOutcomeSchema,
  updateCloseTypeSchema,
} from './close-config.schema.js';
import {
  ConflictError,
  NotFoundError,
  createCloseOutcome,
  createCloseType,
  deleteCloseOutcome,
  deleteCloseType,
  listCloseOutcomes,
  listCloseTypes,
  reorderCloseOutcomes,
  reorderCloseTypes,
  updateCloseOutcome,
  updateCloseType,
} from './close-config.service.js';

const adminGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function closeConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/types', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await listCloseTypes(request.user.tenantId!, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.post('/types', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = createCloseTypeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await createCloseType(request.user.tenantId!, parsed.data, schemaName);
      return reply.code(201).send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      if (error instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.patch('/types/reorder', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = reorderCloseConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await reorderCloseTypes(request.user.tenantId!, parsed.data, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/types/:id', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = updateCloseTypeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await updateCloseType(request.user.tenantId!, request.params.id, parsed.data, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      if (error instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>('/types/:id', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await deleteCloseType(request.user.tenantId!, request.params.id, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      if (error instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.get('/outcomes', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await listCloseOutcomes(request.user.tenantId!, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.post('/outcomes', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = createCloseOutcomeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await createCloseOutcome(request.user.tenantId!, parsed.data, schemaName);
      return reply.code(201).send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      if (error instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.patch('/outcomes/reorder', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = reorderCloseConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await reorderCloseOutcomes(request.user.tenantId!, parsed.data, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/outcomes/:id', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = updateCloseOutcomeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await updateCloseOutcome(request.user.tenantId!, request.params.id, parsed.data, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      if (error instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>('/outcomes/:id', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await deleteCloseOutcome(request.user.tenantId!, request.params.id, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      if (error instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });
}
