import type { FastifyInstance } from 'fastify';
import { conversationsRoutes } from './conversations/conversations.routes.js';

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  await app.register(conversationsRoutes, { prefix: '/conversations' });
}
