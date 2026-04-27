import type { FastifyInstance } from 'fastify';
import { plansRoutes } from './plans/plans.routes.js';
import { tenantsRoutes } from './tenants/tenants.routes.js';
import { metricsRoutes } from './metrics/metrics.routes.js';

export async function superAdminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(plansRoutes, { prefix: '/plans' });
  await app.register(tenantsRoutes, { prefix: '/tenants' });
  await app.register(metricsRoutes, { prefix: '/metrics' });
}
