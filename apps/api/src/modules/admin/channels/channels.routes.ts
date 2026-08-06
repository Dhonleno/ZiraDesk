import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { prisma } from '../../../config/database.js';
import { env } from '../../../config/env.js';
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
  ChannelConfigurationError,
  ChannelNumberConflictError,
} from './channels.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

function resolveSchemaName(user: unknown): string | null {
  const authUser = user as AuthUser;
  return authUser.schemaName ?? null;
}

export async function channelsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/channels/email/inbound-address — antes de /:id
  // O formato precisa casar com extractTenantFromEmail em email.webhook.ts,
  // senão o tenant configura um forward que o webhook nunca reconhece.
  app.get('/email/inbound-address', { preHandler: guard }, async (request, reply) => {
    const tenantId = (request.user as AuthUser).tenantId;
    const tenant = tenantId
      ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } })
      : null;

    if (!tenant) {
      return reply.code(404).send({ success: false, error: { message: 'Tenant não encontrado' } });
    }

    const domain = (env.INBOUND_EMAIL_DOMAIN ?? 'ziradesk.com').trim().toLowerCase();

    return reply.send({
      success: true,
      data: {
        address: `suporte@${tenant.slug}.${domain}`,
        alias: `tickets+${tenant.slug}@${domain}`,
      },
    });
  });

  app.get('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request.user);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const data = await listChannels(schemaName);
    return reply.send({ success: true, data });
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request.user);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    try {
      const data = await getChannel(request.params.id, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request.user);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = createChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const data = await createChannel(parsed.data, schemaName);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ChannelNumberConflictError) {
        return reply.code(err.statusCode).send({
          success: false,
          error: { code: 'CHANNEL_NUMBER_ALREADY_REGISTERED', message: err.message },
        });
      }
      if (err instanceof ChannelConfigurationError) {
        return reply.code(err.statusCode).send({
          success: false,
          error: { code: 'CHANNEL_CONFIGURATION_FAILED', message: err.message },
        });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request.user);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = updateChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const tenantId = (request.user as AuthUser).tenantId;
      const data = await updateChannel(request.params.id, parsed.data, schemaName, tenantId);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ChannelNumberConflictError) {
        return reply.code(err.statusCode).send({
          success: false,
          error: { code: 'CHANNEL_NUMBER_ALREADY_REGISTERED', message: err.message },
        });
      }
      if (err instanceof ChannelConfigurationError) {
        return reply.code(err.statusCode).send({
          success: false,
          error: { code: 'CHANNEL_CONFIGURATION_FAILED', message: err.message },
        });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request.user);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    try {
      const data = await deleteChannel(request.params.id, schemaName);
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
        if (err instanceof ChannelConfigurationError) {
          return reply.code(err.statusCode).send({
            success: false,
            error: { code: 'CHANNEL_CONFIGURATION_FAILED', message: err.message },
          });
        }
        const message = err instanceof Error ? err.message : 'Erro ao testar canal';
        return reply.code(502).send({
          success: false,
          error: { code: 'CHANNEL_TEST_FAILED', message },
        });
      }
    },
  );
}
