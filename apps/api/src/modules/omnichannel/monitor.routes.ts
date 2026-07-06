import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.js';
import { hasRole } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import {
  closeMonitorBotConversation,
  getMonitorSnapshot,
  listMonitorBotConversations,
  MonitorBotConflictError,
  MonitorBotInvalidStateError,
  MonitorBotNotFoundError,
  pullMonitorBotConversation,
} from './monitor.service.js';
import { getTvSnapshot } from './tv.service.js';
import { getSocketServer } from '../../socket/index.js';
import { prisma } from '../../config/database.js';
import { quoteIdent } from './conversations/protocols.js';

const guard = [authMiddleware, tenantSchemaFromJwt];
const closeBotConversationBodySchema = z.object({
  message: z.string().trim().max(1000).optional(),
}).optional();

function getSchemaName(user: { schemaName?: string }): string | undefined {
  return 'schemaName' in user ? user.schemaName : undefined;
}

export async function omnichannelMonitorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/monitor', { preHandler: guard }, async (request, reply) => {
    const schemaName = getSchemaName(request.user);
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }

    const data = await getMonitorSnapshot(schemaName);

    try {
      const io = getSocketServer();
      const tenantId = request.user.tenantId!;
      const connectedSockets = await io.in(`tenant:${tenantId}`).fetchSockets();
      const connectedUserIds = new Set(
        connectedSockets
          .map((socket) => String(socket.data.userId ?? ''))
          .filter((value) => value.length > 0),
      );

      const staleOnlineAgentIds = data.agents
        .filter((agent) => agent.status === 'online' && !connectedUserIds.has(agent.id))
        .map((agent) => agent.id);

      if (staleOnlineAgentIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE ${quoteIdent(schemaName)}.agent_assignments
           SET status = 'offline',
               is_available = false,
               online_since = NULL
           WHERE status = 'online'
             AND user_id = ANY($1::uuid[])`,
          staleOnlineAgentIds,
        );
      }

      data.agents = data.agents.map((agent) => {
        if (agent.status === 'online' && !connectedUserIds.has(agent.id)) {
          return { ...agent, status: 'offline' };
        }
        return agent;
      });
    } catch {
      // If socket server is unavailable, keep DB-based status as fallback.
    }

    return reply.send({ success: true, data });
  });

  app.get('/monitor/bot', { preHandler: guard }, async (request, reply) => {
    const schemaName = getSchemaName(request.user);
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }

    const data = await listMonitorBotConversations(schemaName);
    return reply.send({ success: true, data });
  });

  app.post<{ Params: { id: string } }>(
    '/monitor/bot/:id/pull',
    { preHandler: guard },
    async (request, reply) => {
      const schemaName = getSchemaName(request.user);
      if (!schemaName) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Schema do tenant nao identificado' },
        });
      }

      try {
        const result = await pullMonitorBotConversation(schemaName, request.params.id, request.user.id);
        const io = getSocketServer();
        io.to(`tenant:${request.user.tenantId}`).emit('conversation:updated', {
          conversationId: request.params.id,
          assigned_to: null,
          status: 'open',
          queue_entered_at: result.queue_entered_at,
        });

        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof MonitorBotNotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        if (err instanceof MonitorBotInvalidStateError) {
          return reply.code(422).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/monitor/bot/:id/close',
    { preHandler: guard },
    async (request, reply) => {
      const schemaName = getSchemaName(request.user);
      if (!schemaName) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Schema do tenant nao identificado' },
        });
      }

      const parsed = closeBotConversationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }

      try {
        const result = await closeMonitorBotConversation(
          schemaName,
          request.params.id,
          request.user.id,
          parsed.data?.message,
        );
        const io = getSocketServer();
        io.to(`tenant:${request.user.tenantId}`).emit('conversation:updated', {
          conversationId: request.params.id,
          status: 'closed',
        });

        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof MonitorBotNotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        if (err instanceof MonitorBotConflictError) {
          return reply.code(409).send({ success: false, error: { message: err.message } });
        }
        if (err instanceof MonitorBotInvalidStateError) {
          return reply.code(422).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  app.get(
    '/tv',
    { preHandler: [authMiddleware, hasRole('owner', 'admin', 'supervisor' as never), tenantSchemaFromJwt] },
    async (request, reply) => {
    const schemaName = getSchemaName(request.user);
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }

    const data = await getTvSnapshot(schemaName);
    return reply.send({ success: true, data });
    },
  );
}
