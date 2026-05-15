import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { hasRole } from '../../middleware/rbac.js';
import { plansRoutes } from './plans/plans.routes.js';
import { tenantsRoutes } from './tenants/tenants.routes.js';
import { metricsRoutes } from './metrics/metrics.routes.js';
import { getSuperAdminTenantStats } from './tenants/tenants.service.js';

export async function superAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats', { preHandler: [authMiddleware, hasRole('super_admin')] }, async (_request, reply) => {
    const stats = await getSuperAdminTenantStats();
    return reply.send({ success: true, data: stats });
  });

  await app.register(plansRoutes, { prefix: '/plans' });
  await app.register(tenantsRoutes, { prefix: '/tenants' });
  await app.register(metricsRoutes, { prefix: '/metrics' });
}
