import type { FastifyInstance } from 'fastify';
import { skillsRoutes } from './skills.routes.js';

export async function adminSkillsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(skillsRoutes, { prefix: '/skills' });
}
