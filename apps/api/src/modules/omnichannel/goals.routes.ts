import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import {
  createGoalSchema,
  goalParamsSchema,
  goalsQuerySchema,
  updateGoalSchema,
} from './goals.schema.js';
import {
  GoalConflictError,
  GoalNotFoundError,
  createGoal,
  deleteGoal,
  listGoals,
  resolveGoalsSchema,
  updateGoal,
} from './goals.service.js';

export async function omnichannelGoalsRoutes(app: FastifyInstance): Promise<void> {
  const guard = [authMiddleware, tenantSchemaFromJwt, requirePermission('metrics:view')];

  app.get('/goals', { preHandler: guard }, async (request, reply) => {
    const parsed = goalsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const schemaName = await resolveGoalsSchema(request.user.tenantId);
    if (!schemaName) {
      return reply.send({ success: true, data: [] });
    }

    const data = await listGoals(schemaName, parsed.data.include_inactive);
    return reply.send({ success: true, data });
  });

  app.post('/goals', { preHandler: guard }, async (request, reply) => {
    const parsed = createGoalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = await resolveGoalsSchema(request.user.tenantId);
    if (!schemaName) {
      return reply.code(404).send({
        success: false,
        error: { message: 'Tenant não encontrado' },
      });
    }

    try {
      const data = await createGoal(schemaName, parsed.data);
      return reply.code(201).send({ success: true, data });
    } catch (error) {
      if (error instanceof GoalConflictError) {
        return reply.code(409).send({
          success: false,
          error: { message: error.message },
        });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/goals/:id', { preHandler: guard }, async (request, reply) => {
    const paramsParsed = goalParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Parâmetros inválidos', details: paramsParsed.error.flatten() },
      });
    }

    const bodyParsed = updateGoalSchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: bodyParsed.error.flatten() },
      });
    }

    const schemaName = await resolveGoalsSchema(request.user.tenantId);
    if (!schemaName) {
      return reply.code(404).send({
        success: false,
        error: { message: 'Tenant não encontrado' },
      });
    }

    try {
      const data = await updateGoal(schemaName, paramsParsed.data.id, bodyParsed.data);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof GoalNotFoundError) {
        return reply.code(404).send({
          success: false,
          error: { message: error.message },
        });
      }

      if (error instanceof GoalConflictError) {
        return reply.code(409).send({
          success: false,
          error: { message: error.message },
        });
      }

      return reply.code(400).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao atualizar meta' },
      });
    }
  });

  app.delete<{ Params: { id: string } }>('/goals/:id', { preHandler: guard }, async (request, reply) => {
    const paramsParsed = goalParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Parâmetros inválidos', details: paramsParsed.error.flatten() },
      });
    }

    const schemaName = await resolveGoalsSchema(request.user.tenantId);
    if (!schemaName) {
      return reply.code(404).send({
        success: false,
        error: { message: 'Tenant não encontrado' },
      });
    }

    try {
      const data = await deleteGoal(schemaName, paramsParsed.data.id);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof GoalNotFoundError) {
        return reply.code(404).send({
          success: false,
          error: { message: error.message },
        });
      }
      throw error;
    }
  });
}
