import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { authMiddleware } from '../../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  createConversationBodySchema,
  sendMessageBodySchema,
  updateConversationBodySchema,
  assignConversationBodySchema,
  transferConversationBodySchema,
} from './conversations.schema.js';
import {
  listConversations,
  getConversationWithMessages,
  listConversationMessages,
  sendMessage,
  updateConversation,
  createConversation,
  assignConversation,
  transferConversation,
  NotFoundError,
} from './conversations.service.js';
import { getSocketServer } from '../../../socket/index.js';
import { messageQueue } from '../../../jobs/queue.js';
import { decryptCredentials } from '../../../utils/crypto.js';

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
    const result = await listConversations(parsed.data, request.user.id);
    return reply.send({ success: true, ...result });
  });

  // POST /api/omnichannel/conversations
  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = createConversationBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const conversation = await createConversation(parsed.data, request.user.id);
      const tenantUser = request.user as AuthUser;

      const io = getSocketServer();
      io.to(`tenant:${tenantUser.tenantId}`).emit('conversation:created', { conversation });

      return reply.code(201).send({ success: true, data: conversation });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // GET /api/omnichannel/conversations/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const result = await getConversationWithMessages(request.params.id, request.user.tenantId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // GET /api/omnichannel/conversations/:id/messages
  app.get<{ Params: { id: string } }>('/:id/messages', { preHandler: guard }, async (request, reply) => {
    const parsed = listMessagesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const result = await listConversationMessages(request.params.id, parsed.data, request.user.tenantId);
    return reply.send({
      success: true,
      data: result.messages,
      has_more: result.has_more,
      total: result.total,
    });
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
        const result = await sendMessage(request.params.id, request.user.id, parsed.data);
        const tenantUser = request.user as AuthUser;

        const io = getSocketServer();
        io.to(`tenant:${tenantUser.tenantId}`).emit('conversation:new_message', {
          conversationId: request.params.id,
          message: result.message,
        });

        if (result.channelCredentials) {
          const creds = decryptCredentials(result.channelCredentials);
          const queueData = {
            messageId: result.message.id,
            conversationId: request.params.id,
            channelType: result.channelType,
            channelCredentials: creds,
            content: parsed.data.content ?? '',
            to: result.clientPhone ?? result.clientEmail ?? '',
            mediaId: result.mediaId,
            mediaType: result.mediaType,
            mediaFilename: result.mediaFilename,
          };
          request.log.info(
            {
              conversationId: request.params.id,
              messageId: result.message.id,
              mediaId: queueData.mediaId,
              mediaType: queueData.mediaType,
              mediaFilename: queueData.mediaFilename,
              to: queueData.to,
            },
            '[Omnichannel] enqueue send job',
          );
          await messageQueue.add('send', {
            ...queueData,
          });
        }

        return reply.code(201).send({ success: true, data: result.message });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // POST /api/omnichannel/conversations/:id/assign
  app.post<{ Params: { id: string } }>(
    '/:id/assign',
    { preHandler: guard },
    async (request, reply) => {
      const parsed = assignConversationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }
      try {
        const conversation = await assignConversation(request.params.id, parsed.data.user_id, request.user.id);
        const tenantUser = request.user as AuthUser;

        const io = getSocketServer();
        io.to(`agent:${parsed.data.user_id}`).emit('conversation:assigned', {
          conversationId: request.params.id,
        });
        io.to(`agent:${parsed.data.user_id}`).emit('notification:new', {
          id: request.params.id,
          type: 'conversation_assigned',
          title: 'Conversa atribuída',
          message: 'Você recebeu uma nova conversa.',
          href: `/omnichannel/conversations?conversation=${request.params.id}`,
        });
        io.to(`tenant:${tenantUser.tenantId}`).emit('conversation:updated', {
          conversationId: request.params.id,
        });

        return reply.send({ success: true, data: conversation });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // POST /api/omnichannel/conversations/:id/transfer
  app.post<{ Params: { id: string } }>(
    '/:id/transfer',
    { preHandler: guard },
    async (request, reply) => {
      const parsed = transferConversationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }
      try {
        const conversation = await transferConversation(
          request.params.id,
          parsed.data.user_id,
          request.user.id,
          parsed.data.reason,
        );
        const tenantUser = request.user as AuthUser;

        const io = getSocketServer();
        io.to(`agent:${parsed.data.user_id}`).emit('conversation:transferred', {
          conversationId: request.params.id,
          reason: parsed.data.reason,
        });
        io.to(`tenant:${tenantUser.tenantId}`).emit('conversation:updated', {
          conversationId: request.params.id,
        });

        return reply.send({ success: true, data: conversation });
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
      const conversation = await updateConversation(request.params.id, parsed.data, request.user.id);
      const tenantUser = request.user as AuthUser;

      const io = getSocketServer();
      if (parsed.data.status === 'resolved') {
        io.to(`tenant:${tenantUser.tenantId}`).emit('conversation:resolved', {
          conversationId: request.params.id,
        });
      }
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
