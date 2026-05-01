import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  createBotOptionSchema,
  createBotSubOptionSchema,
  reorderBotOptionsSchema,
  updateBotMenuSchema,
  updateBotOptionSchema,
} from './bot.schema.js';
import {
  ConflictError,
  NotFoundError,
  addOption,
  addSubOption,
  deleteOption,
  getMenu,
  getOptionWithChildren,
  reorderOptions,
  updateMenu,
  updateOption,
} from './bot.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function botRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (_request, reply) => {
    const data = await getMenu();
    return reply.send({ success: true, data });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const parsed = updateBotMenuSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const data = await updateMenu(parsed.data);
    return reply.send({ success: true, data });
  });

  app.post('/options', { preHandler: guard }, async (request, reply) => {
    const parsed = createBotOptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await addOption(parsed.data);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post<{ Params: { parentId: string } }>('/options/:parentId/sub', { preHandler: guard }, async (request, reply) => {
    const parsed = createBotSubOptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await addSubOption(request.params.parentId, parsed.data);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/options/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const data = await getOptionWithChildren(request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/options/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateBotOptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await updateOption(request.params.id, parsed.data);
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

  app.delete<{ Params: { id: string } }>('/options/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const data = await deleteOption(request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post('/options/reorder', { preHandler: guard }, async (request, reply) => {
    const parsed = reorderBotOptionsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const data = await reorderOptions(parsed.data.orderedIds);
    return reply.send({ success: true, data });
  });
}
