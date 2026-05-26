import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { getOverview } from './metrics.service.js';
import { getLgpdMetrics } from './lgpd-metrics.service.js';

const guard = [authMiddleware, hasRole('super_admin')];

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/overview', { preHandler: guard }, async (_request, reply) => {
    const data = await getOverview();
    return reply.send({ success: true, data });
  });

  app.get('/lgpd', { preHandler: guard }, async (_request, reply) => {
    const data = await getLgpdMetrics();
    return reply.send({ success: true, data });
  });
}
