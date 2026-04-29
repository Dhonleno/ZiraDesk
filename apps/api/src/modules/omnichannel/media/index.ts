import type { FastifyInstance } from 'fastify';
import { mediaRoutes } from './media.routes.js';

export async function omnichannelMediaRoutes(app: FastifyInstance): Promise<void> {
  await app.register(mediaRoutes, { prefix: '/media' });
}
