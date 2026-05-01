import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { getSocketServer } from '../../../socket/index.js';
import {
  addConversationTagSchema,
  createTagSchema,
  updateTagSchema,
} from './conversation-tags.schema.js';
import {
  ConflictError,
  NotFoundError,
  addTagToConversation,
  createTag,
  deleteTag,
  getConversationTags,
  listTags,
  removeTagFromConversation,
  updateTag,
} from './conversation-tags.service.js';

const adminGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];
const conversationGuard = [authMiddleware, tenantSchemaFromJwt];

export async function conversationTagsAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await listTags(request.user.tenantId!, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post('/', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = createTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await createTag(request.user.tenantId!, parsed.data, schemaName);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = updateTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await updateTag(request.user.tenantId!, request.params.id, parsed.data, schemaName);
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

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await deleteTag(request.user.tenantId!, request.params.id, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}

export async function conversationTagsOmnichannelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tags', { preHandler: conversationGuard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await listTags(request.user.tenantId!, schemaName);
    return reply.send({ success: true, data });
  });

  app.get<{ Params: { id: string } }>('/:id/tags', { preHandler: conversationGuard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await getConversationTags(request.user.tenantId!, request.params.id, schemaName);
    return reply.send({ success: true, data });
  });

  app.post<{ Params: { id: string } }>('/:id/tags', { preHandler: conversationGuard }, async (request, reply) => {
    const parsed = addConversationTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      await addTagToConversation(
        request.user.tenantId!,
        request.params.id,
        parsed.data.tag_id,
        request.user.id,
        schemaName,
      );

      const io = getSocketServer();
      io.to(`tenant:${request.user.tenantId}`).emit('conversation:tag_added', {
        conversationId: request.params.id,
        tagId: parsed.data.tag_id,
      });

      return reply.code(201).send({ success: true, data: { conversationId: request.params.id, tagId: parsed.data.tag_id } });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string; tagId: string } }>(
    '/:id/tags/:tagId',
    { preHandler: conversationGuard },
    async (request, reply) => {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await removeTagFromConversation(
        request.user.tenantId!,
        request.params.id,
        request.params.tagId,
        schemaName,
      );

      const io = getSocketServer();
      io.to(`tenant:${request.user.tenantId}`).emit('conversation:tag_removed', {
        conversationId: request.params.id,
        tagId: request.params.tagId,
      });

      return reply.send({ success: true, data });
    },
  );
}
