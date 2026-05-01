import type { FastifyInstance } from 'fastify';
import { autoAssignRoutes } from './auto-assign.routes.js';

export async function adminAutoAssignRoutes(app: FastifyInstance): Promise<void> {
  await app.register(autoAssignRoutes, { prefix: '/auto-assign' });
}
