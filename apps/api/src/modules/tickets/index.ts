import type { FastifyInstance } from 'fastify';
import { ticketsRoutes } from './tickets.routes.js';

export async function ticketModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(ticketsRoutes, { prefix: '/' });
}
