import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { assignSkillSchema, createSkillSchema, updateSkillSchema } from './skills.schema.js';
import {
  assignSkill,
  createSkill,
  deleteSkill,
  getAgentSkills,
  getAgentsWithSkills,
  listSkills,
  NotFoundError,
  removeSkill,
  updateSkill,
} from './skills.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await listSkills(request.user.tenantId!, schemaName);
    return reply.send({ success: true, data });
  });

  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = createSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await createSkill(request.user.tenantId!, parsed.data, schemaName);
    return reply.code(201).send({ success: true, data });
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await updateSkill(request.user.tenantId!, request.params.id, parsed.data, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await deleteSkill(request.user.tenantId!, request.params.id, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.get('/agents', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await getAgentsWithSkills(request.user.tenantId!, schemaName);
    return reply.send({ success: true, data });
  });

  app.get<{ Params: { userId: string } }>('/agents/:userId', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const data = await getAgentSkills(request.user.tenantId!, request.params.userId, schemaName);
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
      const data = await assignSkill(request.user.tenantId!, request.params.userId, parsed.data, schemaName);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete<{ Params: { userId: string; skillId: string } }>(
    '/agents/:userId/:skillId',
    { preHandler: guard },
    async (request, reply) => {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await removeSkill(
        request.user.tenantId!,
        request.params.userId,
        request.params.skillId,
        schemaName,
      );
      return reply.send({ success: true, data });
    },
  );
}
