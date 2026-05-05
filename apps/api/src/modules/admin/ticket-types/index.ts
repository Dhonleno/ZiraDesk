import type { FastifyInstance } from 'fastify';
import { ticketTypesRoutes } from './ticket-types.routes.js';

export async function adminTicketTypesRoutes(app: FastifyInstance): Promise<void> {
  await app.register(ticketTypesRoutes, { prefix: '/ticket-types' });
}
