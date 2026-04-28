import type { FastifyInstance } from 'fastify';
import { conversationsRoutes } from './conversations.routes.js';

export async function omnichannelRoutes(app: FastifyInstance): Promise<void> {
  await app.register(conversationsRoutes, { prefix: '/conversations' });
}
