import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import {
  NotFoundError,
  listActiveCloseConfig,
} from '../admin/close-config/close-config.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

export async function omnichannelCloseConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/close-config', { preHandler: guard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await listActiveCloseConfig(request.user.tenantId!, schemaName);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });
}
