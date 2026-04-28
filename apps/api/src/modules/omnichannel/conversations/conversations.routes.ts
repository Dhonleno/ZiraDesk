import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { authMiddleware } from '../../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  listConversationsQuerySchema,
  sendMessageBodySchema,
  updateConversationBodySchema,
} from './conversations.schema.js';
import {
  listConversations,
  getConversationWithMessages,
  sendMessage,
  updateConversation,
  NotFoundError,
} from './conversations.service.js';
import { getSocketServer } from '../../../socket/index.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

export async function conversationsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/omnichannel/conversations
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const parsed = listConversationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    const result = await listConversations(parsed.data);
    return reply.send({ success: true, ...result });
  });

  // GET /api/omnichannel/conversations/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const result = await getConversationWithMessages(request.params.id);
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/omnichannel/conversations/:id/messages
  app.post<{ Params: { id: string } }>(
    '/:id/messages',
    { preHandler: guard },
    async (request, reply) => {
      const parsed = sendMessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }
      try {
        const message = await sendMessage(request.params.id, request.user.id, parsed.data);
        const tenantUser = request.user as AuthUser;

        const io = getSocketServer();
        io.to(`tenant:${tenantUser.tenantId}`).emit('conversation:new_message', {
          conversationId: request.params.id,
          message,
        });

        return reply.code(201).send({ success: true, data: message });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // PATCH /api/omnichannel/conversations/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateConversationBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const conversation = await updateConversation(request.params.id, parsed.data);
      const tenantUser = request.user as AuthUser;

      const io = getSocketServer();
      io.to(`tenant:${tenantUser.tenantId}`).emit('conversation:updated', { conversation });

      return reply.send({ success: true, data: conversation });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
