import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  downloadMetaMediaById,
  downloadMetaMedia,
  getMetaMediaInfo,
  uploadConversationMedia,
} from './media.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/amr',
  'audio/aac',
  'audio/opus',
  'video/mp4',
  'video/3gpp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: 16 * 1024 * 1024,
      files: 1,
    },
  });

  app.post('/upload', { preHandler: guard }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Content-Type deve ser multipart/form-data' },
      });
    }

    let fileBuffer: Buffer | null = null;
    let fileMimeType: string | null = null;
    let fileName: string | null = null;
    let conversationId: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'field' && part.fieldname === 'conversation_id') {
        conversationId = String(part.value ?? '').trim() || null;
        continue;
      }

      if (part.type === 'file' && part.fieldname === 'file' && !fileBuffer) {
        fileBuffer = await part.toBuffer();
        fileMimeType = part.mimetype;
        fileName = part.filename;
        continue;
      }

      if (part.type === 'file') {
        await part.toBuffer();
      }
    }

    if (!fileBuffer || !fileMimeType || !fileName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Arquivo não enviado' },
      });
    }

    if (!ACCEPTED_TYPES.has(fileMimeType)) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Tipo ${fileMimeType} não é suportado pelo WhatsApp`,
        },
      });
    }

    if (!conversationId) {
      return reply.code(400).send({
        success: false,
        error: { message: 'conversation_id é obrigatório' },
      });
    }

    try {
      const result = await uploadConversationMedia({
        tenantId: request.user.tenantId!,
        conversationId,
        file: fileBuffer,
        mimeType: fileMimeType,
        filename: fileName,
        sizeBytes: fileBuffer.length,
      });

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao enviar arquivo';
      request.log.error(
        {
          err: error,
          conversationId,
          mimeType: fileMimeType,
          filename: fileName,
          sizeBytes: fileBuffer.length,
        },
        '[Omnichannel Media] upload failed',
      );
      return reply.code(400).send({ success: false, error: { message } });
    }
  });

  app.get<{ Params: { mediaId: string }; Querystring: { conversation_id?: string } }>(
    '/:mediaId/info',
    { preHandler: guard },
    async (request, reply) => {
      const conversationId = request.query.conversation_id;
      if (!conversationId) {
        return reply.code(400).send({
          success: false,
          error: { message: 'conversation_id é obrigatório' },
        });
      }

      try {
        const info = await getMetaMediaInfo({
          tenantId: request.user.tenantId!,
          conversationId,
          mediaId: request.params.mediaId,
        });
        return reply.send({
          success: true,
          data: info,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro ao buscar mídia';
        return reply.code(400).send({ success: false, error: { message } });
      }
    },
  );

  app.get<{ Params: { mediaId: string }; Querystring: { conversation_id?: string } }>(
    '/:mediaId/content',
    { preHandler: guard },
    async (request, reply) => {
      const conversationId = request.query.conversation_id;
      if (!conversationId) {
        return reply.code(400).send({
          success: false,
          error: { message: 'conversation_id é obrigatório' },
        });
      }

      try {
        const media = await downloadMetaMedia({
          tenantId: request.user.tenantId!,
          conversationId,
          mediaId: request.params.mediaId,
        });

        reply.header('Content-Type', media.mimeType);
        if (media.contentLength > 0) {
          reply.header('Content-Length', String(media.contentLength));
        }
        return reply.send(media.buffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro ao baixar mídia';
        return reply.code(400).send({ success: false, error: { message } });
      }
    },
  );

  app.get<{ Params: { mediaId: string } }>(
    '/:mediaId',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const media = await downloadMetaMediaById({
          tenantId: request.user.tenantId!,
          mediaId: request.params.mediaId,
        });

        reply
          .header('Content-Type', media.mimeType)
          .header('Cache-Control', 'public, max-age=3600');

        if (media.contentLength > 0) {
          reply.header('Content-Length', String(media.contentLength));
        }

        return reply.send(media.buffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro ao baixar mídia';
        return reply.code(400).send({ success: false, error: { message } });
      }
    },
  );
}
