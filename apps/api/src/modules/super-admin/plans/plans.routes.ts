import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { createPlanSchema, updatePlanSchema } from './plans.schema.js';
import {
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  NotFoundError,
  ConflictError,
} from './plans.service.js';

const guard = [authMiddleware, hasRole('super_admin')];

export async function plansRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (_request, reply) => {
    const plans = await listPlans();
    return reply.send({ success: true, data: plans });
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const plan = await getPlan(request.params.id);
      return reply.send({ success: true, data: plan });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = createPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }
    try {
      const plan = await createPlan(parsed.data);
      return reply.code(201).send({ success: true, data: plan });
    } catch (err) {
      if (err instanceof ConflictError) return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updatePlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }
    try {
      const plan = await updatePlan(request.params.id, parsed.data);
      return reply.send({ success: true, data: plan });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      await deletePlan(request.params.id);
      return reply.send({ success: true, data: { message: 'Plano desativado' } });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });
}
