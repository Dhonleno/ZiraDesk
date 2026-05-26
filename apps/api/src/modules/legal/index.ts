import type { FastifyInstance } from 'fastify';
import { legalRoutes } from './legal.routes.js';

export async function legalModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(legalRoutes, { prefix: '/' });
}