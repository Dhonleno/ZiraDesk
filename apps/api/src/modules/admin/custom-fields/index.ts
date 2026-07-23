import type { FastifyInstance } from 'fastify';
import { customFieldsRoutes } from './custom-fields.routes.js';

export async function adminCustomFieldsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(customFieldsRoutes, { prefix: '/custom-fields' });
}
