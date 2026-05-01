import type { FastifyInstance } from 'fastify';
import { pauseReasonsRoutes } from './pause-reasons.routes.js';

export async function adminPauseReasonsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(pauseReasonsRoutes, { prefix: '/pause-reasons' });
}
