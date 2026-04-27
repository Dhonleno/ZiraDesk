import type { FastifyInstance } from 'fastify';
import { clientsRoutes } from './clients/clients.routes.js';

export async function crmRoutes(app: FastifyInstance): Promise<void> {
  await app.register(clientsRoutes, { prefix: '/clients' });
}
