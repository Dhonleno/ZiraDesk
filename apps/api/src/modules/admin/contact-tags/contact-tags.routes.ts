import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { createContactTagSchema, updateContactTagSchema } from './contact-tags.schema.js';
import {
  ConflictError,
  NotFoundError,
  createContactTag,
  deleteContactTag,
  listContactTags,
  updateContactTag,
} from './contact-tags.service.js';

const readGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent')];
const writeGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

function getSchemaName(request: { user: { schemaName?: string } }): string | undefined {
  return request.user.schemaName;
}

export async function contactTagsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: readGuard }, async (request, reply) => {
    const schemaName = getSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const data = await listContactTags(schemaName);
    return reply.send({ success: true, data });
  });

  app.post('/', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createContactTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = getSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    try {
      const data = await createContactTag(parsed.data, schemaName);
      return reply.code(201).send({ success: true, data });
    } catch (error) {
      if (error instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = updateContactTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = getSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    try {
      const data = await updateContactTag(request.params.id, parsed.data, schemaName);
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

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: writeGuard }, async (request, reply) => {
    const schemaName = getSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    try {
      const data = await deleteContactTag(request.params.id, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });
}
