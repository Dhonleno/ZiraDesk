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
  requestHelpBodySchema,
} from './conversations.schema.js';
import {
  listConversations,
  getConversationCounts,
  getConversationWithMessages,
  listConversationMessages,
  sendMessage,
  updateConversation,
  createConversation,
  assignConversation,
  transferConversation,
  requestHelp,
  acceptHelp,
  declineHelp,
  endHelp,
  getConversationHelpers,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from './conversations.service.js';
import { getSocketServer } from '../../../socket/index.js';
import { messageQueue } from '../../../jobs/queue.js';
import { decryptCredentials } from '../../../utils/crypto.js';
import { prisma } from '../../../config/database.js';
import { sendCsatMessage } from './csat.service.js';

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
    const result = await listConversations(parsed.data, request.user.id, request.user.tenantId);
    return reply.send({ success: true, ...result });
  });

  // GET /api/omnichannel/conversations/counts
  app.get('/counts', { preHandler: guard }, async (request, reply) => {
    const counts = await getConversationCounts(request.user.id, request.user.tenantId);
    return reply.send({ success: true, data: counts });
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
      const result = await createConversation(parsed.data, request.user.id, request.user.tenantId);
      const tenantUser = request.user as AuthUser;

      const io = getSocketServer();
      io.to(`tenant:${tenantUser.tenantId}`).emit('conversation:created', { conversation: result.conversation });

      for (const dispatch of result.protocolDispatches) {
        if (!dispatch.channelCredentials || !dispatch.contactPhone) continue;
        await messageQueue.add('send', {
          messageId: dispatch.messageId,
          conversationId: result.conversation.id,
          tenantId: tenantUser.tenantId ?? null,
          tenantSchema: tenantUser.schemaName ?? null,
          channelType: dispatch.channelType,
          channelCredentials: dispatch.channelCredentials,
          content: dispatch.content,
          to: dispatch.contactPhone,
        });
      }

      return reply.code(201).send({ success: true, data: result.conversation });
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
            tenantId: tenantUser.tenantId ?? null,
            tenantSchema: tenantUser.schemaName ?? null,
            channelType: result.channelType,
            channelCredentials: creds,
            content: parsed.data.content ?? '',
            to: result.contactPhone ?? result.contactEmail ?? '',
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
        const assignedConversation = await assignConversation(request.params.id, parsed.data.user_id, request.user.id);
        const tenantUser = request.user as AuthUser;

        // Retorna conversa completa com JOINs para o frontend usar diretamente no cache
        const { conversation } = await getConversationWithMessages(request.params.id, tenantUser.tenantId);

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
          assigned_to: assignedConversation.assigned_to,
          status: 'open',
          conversation,
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
        const schemaName = tenantUser.schemaName;
        if (schemaName) {
          sendCsatMessage(request.params.id, schemaName, prisma).catch((err: unknown) => {
            request.log.error({ err, conversationId: request.params.id }, '[CSAT] Error sending survey');
          });
        }
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

  // GET /api/omnichannel/conversations/:id/helpers
  app.get<{ Params: { id: string } }>('/:id/helpers', { preHandler: guard }, async (request, reply) => {
    const data = await getConversationHelpers(request.params.id, request.user.tenantId);
    return reply.send({ success: true, data });
  });

  // POST /api/omnichannel/conversations/:id/request-help
  app.post<{ Params: { id: string } }>('/:id/request-help', { preHandler: guard }, async (request, reply) => {
    const parsed = requestHelpBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const io = getSocketServer();
      const data = await requestHelp(
        request.params.id,
        parsed.data.helper_user_id,
        request.user.id,
        request.user.tenantId,
        io,
      );
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ForbiddenError) {
        return reply.code(403).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/omnichannel/conversations/:id/accept-help
  app.post<{ Params: { id: string } }>('/:id/accept-help', { preHandler: guard }, async (request, reply) => {
    try {
      const io = getSocketServer();
      const data = await acceptHelp(request.params.id, request.user.id, request.user.tenantId, io);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/omnichannel/conversations/:id/decline-help
  app.post<{ Params: { id: string } }>('/:id/decline-help', { preHandler: guard }, async (request, reply) => {
    try {
      const io = getSocketServer();
      const data = await declineHelp(request.params.id, request.user.id, request.user.tenantId, io);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // DELETE /api/omnichannel/conversations/:id/help
  app.delete<{ Params: { id: string } }>('/:id/help', { preHandler: guard }, async (request, reply) => {
    const data = await endHelp(request.params.id, request.user.id, request.user.tenantId);
    return reply.send({ success: true, data });
  });
}
