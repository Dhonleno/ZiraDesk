import type { FastifyInstance } from 'fastify';
import { omnichannelRoutes as conversationsModule } from './conversations/index.js';

export async function omnichannelModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(conversationsModule);
}
