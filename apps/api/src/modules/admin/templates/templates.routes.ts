import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  createTemplateSchema,
  listTemplatesQuerySchema,
  syncTemplatesSchema,
  updateTemplateSchema,
} from './templates.schema.js';
import {
  NotFoundError,
  ValidationError,
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  syncTemplatesFromMeta,
  updateTemplate,
} from './templates.service.js';

const adminGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

function getSchemaName(request: { user: { schemaName?: string } }): string {
  const schemaName = request.user.schemaName;
  if (!schemaName) throw new Error('schemaName ausente no token');
  return schemaName;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean((error as { code?: string })?.code === '23505');
}

export async function templatesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = listTemplatesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
    const data = await listTemplates(schemaName, parsed.data);
    return reply.send({ success: true, data });
  });

  app.post('/', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = createTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await createTemplate(schemaName, parsed.data);
      return reply.code(201).send({ success: true, data });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(400).send({ success: false, error: { message: error.message } });
      }
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ success: false, error: { message: 'Já existe template com esse nome técnico no canal e idioma selecionados' } });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await getTemplate(schemaName, request.params.id);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = updateTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await updateTemplate(schemaName, request.params.id, parsed.data);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(400).send({ success: false, error: { message: error.message } });
      }
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ success: false, error: { message: 'Já existe template com esse nome técnico no canal e idioma selecionados' } });
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: adminGuard }, async (request, reply) => {
    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await deleteTemplate(schemaName, request.params.id);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });

  app.post('/sync', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = syncTemplatesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const data = await syncTemplatesFromMeta(schemaName, parsed.data.channelId);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(400).send({ success: false, error: { message: error.message } });
      }
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: error.message } });
      }
      throw error;
    }
  });
}
