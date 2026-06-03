import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { getSocketServer } from '../../socket/index.js';
import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { syncAgentAvailability } from './conversations/auto-assign.service.js';
import {
  assignQueuedConversationToMe,
  ConflictError,
  listQueueConversations,
} from './conversations/conversations.service.js';
import { listQueueQuerySchema } from './conversations/conversations.schema.js';
import { notifyAgentAssumed } from './queue/queue-notifications.service.js';
import { recalculateQueuePositionsQueue } from '../../jobs/recalculate-queue-positions.job.js';

const queueGuard = [authMiddleware, tenantSchemaFromJwt, requirePermission('conversations:reply')];

export async function omnichannelQueueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/queue', { preHandler: queueGuard }, async (request, reply) => {
    const parsed = listQueueQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const result = await listQueueConversations(parsed.data, request.user.tenantId);
    return reply.send({ success: true, data: result.data, meta: result.meta });
  });

  app.post<{ Params: { id: string } }>('/queue/:id/assign-me', { preHandler: queueGuard }, async (request, reply) => {
    const tenantUser = request.user as AuthUser;
    const tenantId = tenantUser.tenantId ?? null;
    const schemaName = tenantUser.schemaName ?? null;

    try {
      const result = await assignQueuedConversationToMe(
        request.params.id,
        request.user.id,
        request.user.tenantId,
      );

      if (tenantId && schemaName) {
        await syncAgentAvailability(prisma, schemaName, [request.user.id], tenantId);
      }

      const io = getSocketServer();
      io.to(`tenant:${tenantId}`).emit('conversation:assigned', {
        conversationId: request.params.id,
        agentId: request.user.id,
      });
      io.to(`tenant:${tenantId}`).emit('conversation:updated', {
        conversationId: request.params.id,
        assigned_to: request.user.id,
        status: 'open',
      });

      if (schemaName && tenantId) {
        void notifyAgentAssumed(schemaName, tenantId, request.params.id, request.user.id)
          .catch((err) => logger.error({ err }, '[QueueRoutes] Failed to send agent-assumed notification'));

        void recalculateQueuePositionsQueue
          .add('recalculate', { schemaName, tenantId }, { jobId: `recalc-${tenantId}-${Date.now()}` })
          .catch((err) => logger.error({ err }, '[QueueRoutes] Failed to enqueue recalculate job'));
      }

      return reply.send({ success: true, data: result.conversation });
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
