import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { createChannelSchema, updateChannelSchema } from './channels.schema.js';
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
  testChannel,
  NotFoundError,
} from './channels.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

function resolveSchemaName(user: unknown): string | null {
  const authUser = user as AuthUser;
  return authUser.schemaName ?? null;
}

export async function channelsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (_request, reply) => {
    const data = await listChannels();
    return reply.send({ success: true, data });
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const data = await getChannel(request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = createChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    const data = await createChannel(parsed.data);
    return reply.code(201).send({ success: true, data });
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const data = await updateChannel(request.params.id, parsed.data);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const data = await deleteChannel(request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>(
    '/:id/test',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const schemaName = resolveSchemaName(request.user);
        if (!schemaName) {
          return reply.code(500).send({
            success: false,
            error: { message: 'Schema do tenant não resolvido' },
          });
        }
        const data = await testChannel(request.params.id, schemaName);
        return reply.send({ success: true, data });
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        const message = err instanceof Error ? err.message : 'Erro ao testar canal';
        return reply.code(502).send({
          success: false,
          error: { code: 'CHANNEL_TEST_FAILED', message },
        });
      }
    },
  );
}
