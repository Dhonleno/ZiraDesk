import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  getAIConfig,
  updateAIConfig,
  listArticles,
  createArticle,
  deleteArticle,
  toggleArticle,
} from './ai-admin.service.js';
import {
  extractTextFromPDF,
  extractTextFromDOCX,
  extractTextFromURL,
  extractTextFromTXT,
} from '../../ai/ingest.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

const ACCEPTED_FILE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'text/plain': 'txt',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function aiAdminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  });

  // GET /admin/ai/config
  app.get('/config', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(400).send({ success: false, error: { message: 'Schema não identificado' } });

    const data = await getAIConfig(schemaName);
    return reply.send({ success: true, data });
  });

  // PATCH /admin/ai/config
  app.patch('/config', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(400).send({ success: false, error: { message: 'Schema não identificado' } });

    const body = request.body as Record<string, unknown>;
    await updateAIConfig(schemaName, body);
    return reply.send({ success: true });
  });

  // GET /admin/ai/knowledge
  app.get('/knowledge', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(400).send({ success: false, error: { message: 'Schema não identificado' } });

    const data = await listArticles(schemaName);
    return reply.send({ success: true, data });
  });

  // POST /admin/ai/knowledge/manual
  app.post('/knowledge/manual', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const tenantId = request.user.tenantId;
    if (!schemaName || !tenantId) return reply.code(400).send({ success: false, error: { message: 'Tenant não identificado' } });

    const body = request.body as { title?: string; content?: string };
    if (!body.title?.trim() || !body.content?.trim()) {
      return reply.code(400).send({ success: false, error: { message: 'Título e conteúdo são obrigatórios' } });
    }

    const data = await createArticle(schemaName, tenantId, {
      title: body.title.trim(),
      content: body.content.trim(),
      source_type: 'manual',
    });

    return reply.code(201).send({ success: true, data });
  });

  // POST /admin/ai/knowledge/url
  app.post('/knowledge/url', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const tenantId = request.user.tenantId;
    if (!schemaName || !tenantId) return reply.code(400).send({ success: false, error: { message: 'Tenant não identificado' } });

    const body = request.body as { url?: string; title?: string };
    if (!body.url?.trim()) {
      return reply.code(400).send({ success: false, error: { message: 'URL é obrigatória' } });
    }

    let content: string;
    try {
      content = await extractTextFromURL(body.url.trim());
    } catch {
      return reply.code(422).send({ success: false, error: { message: 'Não foi possível processar a URL' } });
    }

    if (!content.trim()) {
      return reply.code(422).send({ success: false, error: { message: 'Nenhum conteúdo extraído da URL' } });
    }

    const title = body.title?.trim() || new URL(body.url.trim()).hostname;
    const data = await createArticle(schemaName, tenantId, {
      title,
      content,
      source_type: 'url',
      source_url: body.url.trim(),
    });

    return reply.code(201).send({ success: true, data });
  });

  // POST /admin/ai/knowledge/file (multipart)
  app.post('/knowledge/file', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const tenantId = request.user.tenantId;
    if (!schemaName || !tenantId) return reply.code(400).send({ success: false, error: { message: 'Tenant não identificado' } });

    if (!request.isMultipart()) {
      return reply.code(400).send({ success: false, error: { message: 'Content-Type deve ser multipart/form-data' } });
    }

    let fileBuffer: Buffer | null = null;
    let mimeType: string | null = null;
    let fileName: string | null = null;
    let customTitle: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'field' && part.fieldname === 'title') {
        customTitle = String(part.value ?? '').trim() || null;
        continue;
      }
      if (part.type === 'file' && part.fieldname === 'file' && !fileBuffer) {
        fileBuffer = await part.toBuffer();
        mimeType = part.mimetype;
        fileName = part.filename;
        continue;
      }
      if (part.type === 'file') await part.toBuffer();
    }

    if (!fileBuffer || !mimeType || !fileName) {
      return reply.code(400).send({ success: false, error: { message: 'Arquivo não enviado' } });
    }

    const ext = ACCEPTED_FILE_TYPES[mimeType];
    if (!ext) {
      return reply.code(400).send({ success: false, error: { message: 'Tipo de arquivo não suportado. Use PDF, DOCX ou TXT.' } });
    }

    let content: string;
    try {
      if (ext === 'pdf') content = await extractTextFromPDF(fileBuffer);
      else if (ext === 'docx') content = await extractTextFromDOCX(fileBuffer);
      else content = await extractTextFromTXT(fileBuffer);
    } catch {
      return reply.code(422).send({ success: false, error: { message: 'Não foi possível extrair texto do arquivo' } });
    }

    if (!content.trim()) {
      return reply.code(422).send({ success: false, error: { message: 'Nenhum conteúdo extraído do arquivo' } });
    }

    const title = customTitle || fileName.replace(/\.[^.]+$/, '');
    const data = await createArticle(schemaName, tenantId, {
      title,
      content,
      source_type: 'file',
      file_name: fileName,
    });

    return reply.code(201).send({ success: true, data });
  });

  // DELETE /admin/ai/knowledge/:id
  app.delete<{ Params: { id: string } }>('/knowledge/:id', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(400).send({ success: false, error: { message: 'Schema não identificado' } });

    await deleteArticle(schemaName, request.params.id);
    return reply.send({ success: true });
  });

  // PATCH /admin/ai/knowledge/:id/toggle
  app.patch<{ Params: { id: string } }>('/knowledge/:id/toggle', { preHandler: guard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(400).send({ success: false, error: { message: 'Schema não identificado' } });

    const body = request.body as { is_active?: boolean };
    if (body.is_active === undefined) {
      return reply.code(400).send({ success: false, error: { message: 'is_active é obrigatório' } });
    }

    await toggleArticle(schemaName, request.params.id, body.is_active);
    return reply.send({ success: true });
  });
}
