import type { FastifyInstance } from 'fastify';
import { portalRoutes } from './portal.routes.js';

export async function portalModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(portalRoutes, { prefix: '/' });
}
