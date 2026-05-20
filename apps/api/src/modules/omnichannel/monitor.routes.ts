import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { hasRole } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { getMonitorSnapshot } from './monitor.service.js';
import { getTvSnapshot } from './tv.service.js';
import { getSocketServer } from '../../socket/index.js';
import { prisma } from '../../config/database.js';
import { quoteIdent } from './conversations/protocols.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

export async function omnichannelMonitorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/monitor', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
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

  app.get('/tv', { preHandler: [authMiddleware, hasRole('owner', 'admin', 'supervisor'), tenantSchemaFromJwt] }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant nao identificado' },
      });
    }

    const data = await getTvSnapshot(schemaName);
    return reply.send({ success: true, data });
  });
}
