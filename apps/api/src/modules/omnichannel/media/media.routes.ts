import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  downloadMetaMedia,
  getMetaMediaInfo,
  uploadConversationMedia,
} from './media.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: 16 * 1024 * 1024,
      files: 1,
    },
  });

  app.post('/upload', { preHandler: guard }, async (request, reply) => {
    const part = await request.file();
    if (!part) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Arquivo não enviado' },
      });
    }

    const conversationField = (part.fields?.conversation_id as { value?: string } | undefined)?.value;
    if (!conversationField) {
      return reply.code(400).send({
        success: false,
        error: { message: 'conversation_id é obrigatório' },
      });
    }

    try {
      const buffer = await part.toBuffer();
      const result = await uploadConversationMedia({
        tenantId: request.user.tenantId!,
        conversationId: conversationField,
        file: buffer,
        mimeType: part.mimetype,
        filename: part.filename,
        sizeBytes: buffer.length,
      });

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao enviar arquivo';
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
}
