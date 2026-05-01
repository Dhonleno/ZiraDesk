import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { assignSkillSchema } from './skills.schema.js';
import {
  assignBotSkill,
  getBotOptionsTree,
  getAgentSkills,
  getAgentsWithSkills,
  NotFoundError,
  removeBotSkill,
} from './skills.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await getBotOptionsTree(request.user.tenantId!, schemaName);
    return reply.send({ success: true, data });
  });

  app.get('/agents', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await getAgentsWithSkills(request.user.tenantId!, schemaName);
    return reply.send({ success: true, data });
  });

  app.get<{ Params: { id: string } }>('/agents/:id', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await getAgentSkills(request.user.tenantId!, request.params.id, schemaName);
    return reply.send({ success: true, data });
  });

  app.post<{ Params: { userId: string } }>('/agents/:userId', { preHandler: guard }, async (request, reply) => {
    const parsed = assignSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await assignBotSkill(request.user.tenantId!, request.params.userId, parsed.data, schemaName);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete<{ Params: { userId: string; botOptionId: string } }>(
    '/agents/:userId/:botOptionId',
    { preHandler: guard },
    async (request, reply) => {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await removeBotSkill(
        request.user.tenantId!,
        request.params.userId,
        request.params.botOptionId,
        schemaName,
      );
      return reply.send({ success: true, data });
    },
  );
}
