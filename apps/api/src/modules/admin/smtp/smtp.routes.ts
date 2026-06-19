import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { authMiddleware } from '../../../middleware/auth.js';
import { requireFeature } from '../../../middleware/entitlement.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { smtpSchema, smtpTestSchema, smtpUpdateSchema } from './smtp.schema.js';
import {
  deleteSmtpConfig,
  getSmtpConfig,
  saveSmtpConfig,
  SmtpConfigNotFoundError,
  SmtpValidationError,
  testSmtpConfig,
  updateSmtpConfig,
} from './smtp.service.js';

const guard = [authMiddleware, requireFeature('email'), tenantSchemaFromJwt, requirePermission('settings:manage')];

function resolveSchemaName(request: FastifyRequest): string | null {
  const authUser = request.user as AuthUser;
  return authUser.schemaName ?? null;
}

export async function smtpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const data = await getSmtpConfig(schemaName);
    return reply.send({ success: true, data });
  });

  app.post('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = smtpSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const data = await saveSmtpConfig(schemaName, parsed.data);
    return reply.code(201).send({ success: true, data });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = smtpUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await updateSmtpConfig(schemaName, parsed.data);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof SmtpConfigNotFoundError) {
        return reply.code(404).send({
          success: false,
          error: { message: error.message },
        });
      }
      throw error;
    }
  });

  app.delete('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const data = await deleteSmtpConfig(schemaName);
    return reply.send({ success: true, data });
  });

  app.post('/test', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = smtpTestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      await testSmtpConfig(schemaName, parsed.data);
      return reply.send({ success: true, message: 'SMTP configurado corretamente' });
    } catch (error) {
      if (error instanceof SmtpValidationError) {
        return reply.code(400).send({
          success: false,
          error: { code: 'SMTP_VALIDATION_ERROR', message: error.message },
        });
      }

      const message = error instanceof Error ? error.message : 'Erro ao testar SMTP';
      return reply.code(502).send({
        success: false,
        error: { code: 'SMTP_ERROR', message },
      });
    }
  });
}

