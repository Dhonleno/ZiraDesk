import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { inviteUserSchema, updateUserSchema, listUsersQuerySchema } from './users.schema.js';
import {
  listUsers,
  getUser,
  inviteUser,
  updateUser,
  deleteUser,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  PlanLimitError,
} from './users.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const parsed = listUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    const result = await listUsers(parsed.data);
    return reply.send({ success: true, ...result });
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const user = await getUser(request.params.id);
      return reply.send({ success: true, data: user });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post('/invite', { preHandler: guard }, async (request, reply) => {
    const parsed = inviteUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const result = await inviteUser(parsed.data, request.user.tenantId!);
      return reply.code(201).send({ success: true, data: result });
    } catch (err) {
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      if (err instanceof PlanLimitError)
        return reply.code(402).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const user = await updateUser(request.params.id, parsed.data);
      return reply.send({ success: true, data: user });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const user = await deleteUser(request.params.id, request.user.id);
      return reply.send({ success: true, data: user });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ForbiddenError)
        return reply.code(403).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });
}
