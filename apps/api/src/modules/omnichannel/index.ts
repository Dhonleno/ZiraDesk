import type { FastifyInstance } from 'fastify';
import { omnichannelRoutes as conversationsModule } from './conversations/index.js';
import { omnichannelMediaRoutes as mediaModule } from './media/index.js';

export async function omnichannelModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(conversationsModule);
  await app.register(mediaModule);
}
