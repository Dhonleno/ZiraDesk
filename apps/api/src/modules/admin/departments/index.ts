import type { FastifyInstance } from 'fastify';
import { departmentsRoutes } from './departments.routes.js';

export async function adminDepartmentsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(departmentsRoutes, { prefix: '/departments' });
}
