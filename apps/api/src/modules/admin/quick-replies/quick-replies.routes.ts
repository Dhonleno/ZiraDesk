import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  createQuickReplySchema,
  listQuickRepliesQuerySchema,
  updateQuickReplySchema,
} from './quick-replies.schema.js';
import {
  ConflictError,
  NotFoundError,
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  updateQuickReply,
} from './quick-replies.service.js';

const readGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent')];
const writeGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function quickRepliesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: readGuard }, async (request, reply) => {
    const parsed = listQuickRepliesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const data = await listQuickReplies(parsed.data);
    return reply.send({ success: true, data });
  });

  app.post('/', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createQuickReplySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await createQuickReply(parsed.data);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = updateQuickReplySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await updateQuickReply(request.params.id, parsed.data);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: writeGuard }, async (request, reply) => {
    try {
      const data = await deleteQuickReply(request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
