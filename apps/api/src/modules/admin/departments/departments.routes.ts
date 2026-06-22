import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addAgentToDepartment,
  removeAgentFromDepartment,
  listDepartmentAgents,
  NotFoundError,
  ConflictError,
} from './departments.service.js';

const guardWrite = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];
const guardRead = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent', 'viewer')];

function schemaName(request: { user: { schemaName?: string } }): string | undefined {
  return 'schemaName' in request.user ? request.user.schemaName : undefined;
}

export async function departmentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guardRead }, async (request, reply) => {
    const data = await listDepartments(request.user.tenantId!, schemaName(request));
    return reply.send({ success: true, data });
  });

  app.post<{ Body: { name: string; description?: string } }>(
    '/',
    { preHandler: guardWrite },
    async (request, reply) => {
      const { name, description } = request.body ?? {};
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return reply.code(400).send({ success: false, error: { message: 'name e obrigatorio' } });
      }
      const trimmedDesc = description?.trim();
      const data = await createDepartment(
        request.user.tenantId!,
        trimmedDesc !== undefined ? { name: name.trim(), description: trimmedDesc } : { name: name.trim() },
        schemaName(request),
      );
      return reply.code(201).send({ success: true, data });
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string | null; isActive?: boolean } }>(
    '/:id',
    { preHandler: guardWrite },
    async (request, reply) => {
      try {
        const data = await updateDepartment(
          request.user.tenantId!,
          request.params.id,
          request.body ?? {},
          schemaName(request),
        );
        return reply.send({ success: true, data });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guardWrite }, async (request, reply) => {
    try {
      await deleteDepartment(request.user.tenantId!, request.params.id, schemaName(request));
      return reply.send({ success: true });
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

  app.get<{ Params: { id: string } }>('/:id/agents', { preHandler: guardRead }, async (request, reply) => {
    const data = await listDepartmentAgents(request.user.tenantId!, request.params.id, schemaName(request));
    return reply.send({ success: true, data });
  });

  app.post<{ Params: { id: string }; Body: { userId: string } }>(
    '/:id/agents',
    { preHandler: guardWrite },
    async (request, reply) => {
      const { userId } = request.body ?? {};
      if (!userId || typeof userId !== 'string') {
        return reply.code(400).send({ success: false, error: { message: 'userId e obrigatorio' } });
      }
      await addAgentToDepartment(request.user.tenantId!, request.params.id, userId, schemaName(request));
      return reply.code(201).send({ success: true });
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/:id/agents/:userId',
    { preHandler: guardWrite },
    async (request, reply) => {
      await removeAgentFromDepartment(
        request.user.tenantId!,
        request.params.id,
        request.params.userId,
        schemaName(request),
      );
      return reply.send({ success: true });
    },
  );
}
