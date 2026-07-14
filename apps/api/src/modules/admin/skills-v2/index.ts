import type { FastifyInstance } from 'fastify';
import { skillsV2Routes } from './skills-v2.routes.js';

export async function adminSkillsV2Routes(app: FastifyInstance): Promise<void> {
  await app.register(skillsV2Routes, { prefix: '/skills-v2' });
}
