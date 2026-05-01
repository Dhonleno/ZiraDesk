import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { getMonitorSnapshot } from './monitor.service.js';

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
    return reply.send({ success: true, data });
  });
}
