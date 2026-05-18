import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  redmineCreateSchema,
  redmineTestSchema,
  redmineUpdateSchema,
} from './redmine.schema.js';
import {
  createOrSaveRedmineIntegration,
  deleteRedmineIntegration,
  getRedmineIntegration,
  testRedmineConnection,
  updateRedmineIntegration,
} from './redmine.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

function getSchemaName(request: { user: { schemaName?: string } }): string {
  if (!request.user.schemaName) throw new Error('schemaName ausente no token');
  return request.user.schemaName;
}

export async function redmineAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
    const data = await getRedmineIntegration(schemaName);
    return reply.send({ success: true, data });
  });

  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = redmineCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
    const data = await createOrSaveRedmineIntegration(schemaName, parsed.data);
    return reply.code(201).send({ success: true, data });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const parsed = redmineUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
    const data = await updateRedmineIntegration(schemaName, parsed.data);
    if (!data) {
      return reply.code(404).send({ success: false, error: { message: 'Integração não encontrada' } });
    }
    return reply.send({ success: true, data });
  });

  app.delete('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
    const removed = await deleteRedmineIntegration(schemaName);
    return reply.send({ success: true, data: { removed } });
  });

  app.post('/test', { preHandler: guard }, async (request, reply) => {
    const parsed = redmineTestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
    const ok = await testRedmineConnection(schemaName, parsed.data);
    if (!ok) {
      return reply.code(400).send({ success: false, error: { message: 'Falha ao conectar ao Redmine' } });
    }
    return reply.send({ success: true, data: { ok: true } });
  });
}
