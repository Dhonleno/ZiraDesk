import type { FastifyInstance } from 'fastify';
import { ticketsRoutes } from './tickets.routes.js';
import { ticketsMetricsRoutes } from './tickets-metrics.routes.js';

export async function ticketModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(ticketsMetricsRoutes, { prefix: '/' });
  await app.register(ticketsRoutes, { prefix: '/' });
}
