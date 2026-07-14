import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  assignAgentSkillSchema,
  assignBotOptionSkillSchema,
  createSkillSchema,
  listSkillsQuerySchema,
  updateSkillSchema,
} from './skills-v2.schema.js';
import {
  ConflictError,
  NotFoundError,
  assignAgentSkill,
  assignBotOptionSkill,
  createSkill,
  deleteSkill,
  getAgentSkills,
  getBotOptionSkills,
  listAgentsWithSkills,
  listSkills,
  removeAgentSkill,
  removeBotOptionSkill,
  updateSkill,
} from './skills-v2.service.js';

const ownerOrAdminGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

function schemaName(request: { user: { schemaName?: string } }): string | undefined {
  return 'schemaName' in request.user ? request.user.schemaName : undefined;
}

export async function skillsV2Routes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: ownerOrAdminGuard }, async (request, reply) => {
    const parsed = listSkillsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    const data = await listSkills(request.user.tenantId!, parsed.data, schemaName(request));
    return reply.send({ success: true, data });
  });

  app.post('/', { preHandler: ownerOrAdminGuard }, async (request, reply) => {
    const parsed = createSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await createSkill(request.user.tenantId!, parsed.data, schemaName(request));
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: ownerOrAdminGuard }, async (request, reply) => {
    const parsed = updateSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await updateSkill(request.user.tenantId!, request.params.id, parsed.data, schemaName(request));
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: ownerOrAdminGuard }, async (request, reply) => {
    try {
      const data = await deleteSkill(request.user.tenantId!, request.params.id, schemaName(request));
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.get('/agents', { preHandler: ownerOrAdminGuard }, async (request, reply) => {
    const data = await listAgentsWithSkills(request.user.tenantId!, schemaName(request));
    return reply.send({ success: true, data });
  });

  app.get<{ Params: { id: string } }>('/agents/:id', { preHandler: ownerOrAdminGuard }, async (request, reply) => {
    const data = await getAgentSkills(request.user.tenantId!, request.params.id, schemaName(request));
    return reply.send({ success: true, data });
  });

  app.post<{ Params: { userId: string } }>(
    '/agents/:userId',
    { preHandler: ownerOrAdminGuard },
    async (request, reply) => {
      const parsed = assignAgentSkillSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados invalidos', details: parsed.error.flatten() },
        });
      }

      try {
        const data = await assignAgentSkill(
          request.user.tenantId!,
          request.params.userId,
          parsed.data,
          schemaName(request),
        );
        return reply.code(201).send({ success: true, data });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { userId: string; skillId: string } }>(
    '/agents/:userId/:skillId',
    { preHandler: ownerOrAdminGuard },
    async (request, reply) => {
      const data = await removeAgentSkill(
        request.user.tenantId!,
        request.params.userId,
        request.params.skillId,
        schemaName(request),
      );
      return reply.send({ success: true, data });
    },
  );

  app.get<{ Params: { botOptionId: string } }>(
    '/bot-options/:botOptionId',
    { preHandler: ownerOrAdminGuard },
    async (request, reply) => {
      const data = await getBotOptionSkills(
        request.user.tenantId!,
        request.params.botOptionId,
        schemaName(request),
      );
      return reply.send({ success: true, data });
    },
  );

  app.post<{ Params: { botOptionId: string } }>(
    '/bot-options/:botOptionId',
    { preHandler: ownerOrAdminGuard },
    async (request, reply) => {
      const parsed = assignBotOptionSkillSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados invalidos', details: parsed.error.flatten() },
        });
      }

      try {
        const data = await assignBotOptionSkill(
          request.user.tenantId!,
          request.params.botOptionId,
          parsed.data,
          schemaName(request),
        );
        return reply.code(201).send({ success: true, data });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { botOptionId: string; skillId: string } }>(
    '/bot-options/:botOptionId/:skillId',
    { preHandler: ownerOrAdminGuard },
    async (request, reply) => {
      const data = await removeBotOptionSkill(
        request.user.tenantId!,
        request.params.botOptionId,
        request.params.skillId,
        schemaName(request),
      );
      return reply.send({ success: true, data });
    },
  );
}
