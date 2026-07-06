import type { FastifyInstance } from 'fastify';
import { ticketCategoriesRoutes } from './ticket-categories.routes.js';

export async function adminTicketCategoriesRoutes(app: FastifyInstance): Promise<void> {
  await app.register(ticketCategoriesRoutes, { prefix: '/ticket-categories' });
}
