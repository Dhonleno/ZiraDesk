import type { FastifyInstance } from 'fastify';
import { leadsRoutes } from './leads.routes.js';

export async function leadsModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(leadsRoutes, { prefix: '/' });
}
