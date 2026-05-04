import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { updateSettingsSchema } from './settings.schema.js';
import {
  getSettings,
  logoMimeTypeFromFileName,
  readLogoFile,
  updateSettings,
  uploadLogo,
} from './settings.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];
const MAX_LOGO_SIZE = 2 * 1024 * 1024;
const ACCEPTED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']);

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_LOGO_SIZE,
      files: 1,
    },
  });

  app.get<{ Params: { fileName: string } }>('/logo/:fileName', async (request, reply) => {
    const file = await readLogoFile(request.params.fileName);
    if (!file) {
      return reply.code(404).send({ success: false, error: { message: 'Logo não encontrada' } });
    }

    reply.header('Content-Type', logoMimeTypeFromFileName(request.params.fileName));
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(file);
  });

  app.get('/', { preHandler: guard }, async (request, reply) => {
    const data = await getSettings(request.user.tenantId!);
    return reply.send({ success: true, data });
  });

  app.post('/logo', { preHandler: guard }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Content-Type deve ser multipart/form-data' },
      });
    }

    let fileBuffer: Buffer | null = null;
    let mimeType: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'logo' && !fileBuffer) {
        fileBuffer = await part.toBuffer();
        mimeType = part.mimetype;
        continue;
      }

      if (part.type === 'file') {
        await part.toBuffer();
      }
    }

    if (!fileBuffer || !mimeType) {
      return reply.code(400).send({ success: false, error: { message: 'Arquivo de logo não enviado' } });
    }

    if (!ACCEPTED_LOGO_TYPES.has(mimeType)) {
      return reply.code(400).send({ success: false, error: { message: 'Formato de imagem inválido' } });
    }

    if (fileBuffer.length > MAX_LOGO_SIZE) {
      return reply.code(400).send({ success: false, error: { message: 'Logo deve ter no máximo 2MB' } });
    }

    const data = await uploadLogo({
      tenantId: request.user.tenantId!,
      fileBuffer,
      mimeType,
    });

    return reply.send({ success: true, data });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    const data = await updateSettings(request.user.tenantId!, parsed.data);
    return reply.send({ success: true, data });
  });
}
