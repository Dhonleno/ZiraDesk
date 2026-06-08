import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../config/database.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { decryptCredentials } from '../../../utils/crypto.js';
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
import {
  uploadHeaderHandle,
  validateTemplateMedia,
} from './templates.media.service.js';

const adminGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];
const MAX_TEMPLATE_MEDIA_SIZE = 100 * 1024 * 1024;

function getSchemaName(request: { user: { schemaName?: string } }): string {
  const schemaName = request.user.schemaName;
  if (!schemaName) throw new Error('schemaName ausente no token');
  return schemaName;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean((error as { code?: string })?.code === '23505');
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function templatesRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_TEMPLATE_MEDIA_SIZE,
      files: 1,
      fields: 1,
    },
  });

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

  app.post('/media-upload', { preHandler: adminGuard }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Content-Type deve ser multipart/form-data' },
      });
    }

    let fileBuffer: Buffer | null = null;
    let mimeType: string | null = null;
    let filename: string | null = null;
    let channelId: string | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === 'field' && part.fieldname === 'channelId') {
          channelId = String(part.value ?? '').trim() || null;
          continue;
        }
        if (part.type === 'file' && part.fieldname === 'file' && !fileBuffer) {
          fileBuffer = await part.toBuffer();
          mimeType = part.mimetype;
          filename = part.filename;
          continue;
        }
        if (part.type === 'file') await part.toBuffer();
      }
    } catch {
      return reply.code(400).send({
        success: false,
        error: { message: 'Não foi possível ler o arquivo enviado. Verifique o tamanho e tente novamente.' },
      });
    }

    if (!channelId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(channelId)) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Canal WhatsApp inválido' },
      });
    }
    if (!fileBuffer || !mimeType || !filename) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Arquivo não enviado' },
      });
    }

    try {
      validateTemplateMedia(mimeType, fileBuffer.length);

      const schemaName = getSchemaName(request as Parameters<typeof getSchemaName>[0]);
      const channels = await prisma.$queryRawUnsafe<Array<{
        type: string;
        status: string;
        credentials: string | object | null;
      }>>(
        `SELECT type, status, credentials
         FROM ${quoteIdent(schemaName)}.channels
         WHERE id = $1::uuid
         LIMIT 1`,
        channelId,
      );
      const channel = channels[0];
      if (!channel || channel.type !== 'whatsapp' || channel.status !== 'active') {
        return reply.code(404).send({
          success: false,
          error: { message: 'Canal WhatsApp ativo não encontrado' },
        });
      }

      const credentials = channel.credentials ? decryptCredentials(channel.credentials) : {};
      const wabaId = String(credentials.wabaId ?? credentials.waba_id ?? '').trim();
      const accessToken = String(credentials.accessToken ?? credentials.access_token ?? '').trim();
      if (!wabaId || !accessToken) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Credenciais da Meta incompletas para este canal' },
        });
      }

      const headerHandle = await uploadHeaderHandle(
        fileBuffer,
        mimeType,
        filename,
        wabaId,
        accessToken,
      );

      return reply.send({
        success: true,
        data: {
          header_handle: headerHandle,
          mime_type: mimeType,
          filename,
        },
      });
    } catch (error) {
      request.log.error(
        {
          err: error,
          channelId,
          mimeType,
          filename,
          sizeBytes: fileBuffer.length,
        },
        '[Templates] media upload failed',
      );
      return reply.code(400).send({
        success: false,
        error: { message: 'Falha no upload para a Meta. Verifique o arquivo e tente novamente.' },
      });
    }
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
