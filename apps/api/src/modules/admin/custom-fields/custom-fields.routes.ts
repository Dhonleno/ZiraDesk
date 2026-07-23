import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { createCustomFieldSchema, updateCustomFieldSchema } from './custom-fields.schema.js';
import {
  ConflictError,
  createCustomField,
  deleteCustomField,
  listCustomFields,
  NotFoundError,
  updateCustomField,
} from './custom-fields.service.js';

const readGuard = [authMiddleware, tenantSchemaFromJwt];
const writeGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function customFieldsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: readGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await listCustomFields(request.user.tenantId!, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post('/', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createCustomFieldSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await createCustomField(request.user.tenantId!, parsed.data, schemaName);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = updateCustomFieldSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await updateCustomField(request.user.tenantId!, request.params.id, parsed.data, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: writeGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await deleteCustomField(request.user.tenantId!, request.params.id, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
