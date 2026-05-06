import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { hasRole } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import {
  createTicketSchema,
  updateTicketSchema,
  listTicketsQuerySchema,
  createCommentSchema,
  updateCommentSchema,
  assignTicketSchema,
  createChecklistItemSchema,
  updateChecklistItemSchema,
  createTimeEntrySchema,
} from './tickets.schema.js';
import {
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket,
  assignTicket,
  listComments,
  addComment,
  updateComment,
  deleteComment,
  listAttachments,
  addAttachment,
  deleteAttachment,
  readAttachmentContent,
  listChecklistItems,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  listTimeEntries,
  addTimeEntry,
  deleteTimeEntry,
  getTicketTimeline,
  getStats,
  NotFoundError,
  ForbiddenError,
} from './tickets.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent')];

export async function ticketsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024,
      files: 1,
    },
  });

  // GET /api/tickets
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const parsed = listTicketsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    const result = await listTickets(parsed.data);
    return reply.send({ success: true, ...result });
  });

  // GET /api/tickets/stats  — must be before /:id to avoid conflict
  app.get('/stats', { preHandler: guard }, async (_request, reply) => {
    const stats = await getStats();
    return reply.send({ success: true, data: stats });
  });

  // POST /api/tickets
  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = createTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    const ticket = await createTicket(parsed.data, request.user.id, request.user.tenantId!);
    return reply.code(201).send({ success: true, data: ticket });
  });

  // GET /api/tickets/:id/timeline
  app.get<{ Params: { id: string } }>('/:id/timeline', { preHandler: guard }, async (request, reply) => {
    try {
      const timeline = await getTicketTimeline(request.params.id);
      return reply.send({ success: true, data: timeline });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // GET /api/tickets/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const ticket = await getTicket(request.params.id);
      return reply.send({ success: true, data: ticket });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // PATCH /api/tickets/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const ticket = await updateTicket(request.params.id, parsed.data, request.user.id, request.user.tenantId!);
      return reply.send({ success: true, data: ticket });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/tickets/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    if (request.user.role !== 'owner' && request.user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { message: 'Acesso negado' } });
    }
    try {
      const result = await deleteTicket(request.params.id, request.user.id, request.user.tenantId!);
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/tickets/:id/assign
  app.post<{ Params: { id: string } }>('/:id/assign', { preHandler: guard }, async (request, reply) => {
    const parsed = assignTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const ticket = await assignTicket(
        request.params.id,
        parsed.data.user_id,
        request.user.id,
        request.user.tenantId!,
      );
      return reply.send({ success: true, data: ticket });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/tickets/:id/comments
  app.get<{ Params: { id: string } }>('/:id/comments', { preHandler: guard }, async (request, reply) => {
    try {
      const comments = await listComments(request.params.id);
      return reply.send({ success: true, data: comments });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/tickets/:id/checklist
  app.get<{ Params: { id: string } }>('/:id/checklist', { preHandler: guard }, async (request, reply) => {
    try {
      const items = await listChecklistItems(request.params.id);
      return reply.send({ success: true, data: items });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/tickets/:id/checklist
  app.post<{ Params: { id: string } }>('/:id/checklist', { preHandler: guard }, async (request, reply) => {
    const parsed = createChecklistItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const item = await addChecklistItem(request.params.id, parsed.data.title);
      return reply.code(201).send({ success: true, data: item });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // PATCH /api/tickets/:id/checklist/:itemId
  app.patch<{ Params: { id: string; itemId: string } }>(
    '/:id/checklist/:itemId',
    { preHandler: guard },
    async (request, reply) => {
      const parsed = updateChecklistItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }

      try {
        const item = await updateChecklistItem(
          request.params.id,
          request.params.itemId,
          parsed.data,
          request.user.id,
        );
        return reply.send({ success: true, data: item });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // DELETE /api/tickets/:id/checklist/:itemId
  app.delete<{ Params: { id: string; itemId: string } }>(
    '/:id/checklist/:itemId',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const result = await deleteChecklistItem(request.params.id, request.params.itemId);
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // GET /api/tickets/:id/time
  app.get<{ Params: { id: string } }>('/:id/time', { preHandler: guard }, async (request, reply) => {
    try {
      const entries = await listTimeEntries(request.params.id);
      return reply.send({ success: true, data: entries });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/tickets/:id/time
  app.post<{ Params: { id: string } }>('/:id/time', { preHandler: guard }, async (request, reply) => {
    const parsed = createTimeEntrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const entry = await addTimeEntry(request.params.id, request.user.id, parsed.data);
      return reply.code(201).send({ success: true, data: entry });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // DELETE /api/tickets/:id/time/:entryId
  app.delete<{ Params: { id: string; entryId: string } }>(
    '/:id/time/:entryId',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const result = await deleteTimeEntry(
          request.params.id,
          request.params.entryId,
          request.user.id,
          request.user.role,
        );
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        if (err instanceof ForbiddenError) {
          return reply.code(403).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // POST /api/tickets/:id/comments
  app.post<{ Params: { id: string } }>('/:id/comments', { preHandler: guard }, async (request, reply) => {
    const parsed = createCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const comment = await addComment(
        request.params.id,
        parsed.data,
        request.user.id,
        request.user.tenantId!,
      );
      return reply.code(201).send({ success: true, data: comment });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/tickets/:id/comments/:commentId
  app.patch<{ Params: { id: string; commentId: string } }>(
    '/:id/comments/:commentId',
    { preHandler: guard },
    async (request, reply) => {
      const parsed = updateCommentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }
      try {
        const result = await updateComment(
          request.params.id,
          request.params.commentId,
          parsed.data,
          request.user.id,
          request.user.role,
          request.user.tenantId!,
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        if (err instanceof ForbiddenError)
          return reply.code(403).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // DELETE /api/tickets/:id/comments/:commentId
  app.delete<{ Params: { id: string; commentId: string } }>(
    '/:id/comments/:commentId',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const result = await deleteComment(
          request.params.commentId,
          request.user.id,
          request.user.role,
          request.user.tenantId!,
        );
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        if (err instanceof ForbiddenError)
          return reply.code(403).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // GET /api/tickets/:id/attachments
  app.get<{ Params: { id: string } }>('/:id/attachments', { preHandler: guard }, async (request, reply) => {
    try {
      const attachments = await listAttachments(request.params.id);
      return reply.send({ success: true, data: attachments });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/tickets/:id/attachments
  app.post<{ Params: { id: string } }>('/:id/attachments', { preHandler: guard }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Content-Type deve ser multipart/form-data' },
      });
    }

    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let mimeType = '';
    let commentId: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file' && !fileBuffer) {
        fileBuffer = await part.toBuffer();
        fileName = part.filename;
        mimeType = part.mimetype;
        continue;
      }

      if (part.type === 'field' && part.fieldname === 'comment_id') {
        const rawValue = String(part.value ?? '').trim();
        commentId = rawValue || null;
        continue;
      }

      if (part.type === 'file') {
        await part.toBuffer();
      }
    }

    if (!fileBuffer || !fileName || !mimeType) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Arquivo não enviado' },
      });
    }

    try {
      const data = await addAttachment({
        ticketId: request.params.id,
        commentId,
        userId: request.user.id,
        fileName,
        mimeType,
        buffer: fileBuffer,
      });
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ForbiddenError) {
        return reply.code(403).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // DELETE /api/tickets/attachments/:attachmentId
  app.delete<{ Params: { attachmentId: string } }>(
    '/attachments/:attachmentId',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const result = await deleteAttachment(request.params.attachmentId, request.user.id);
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        if (err instanceof ForbiddenError) {
          return reply.code(403).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // GET /api/tickets/attachments/:attachmentId/content
  app.get<{ Params: { attachmentId: string } }>(
    '/attachments/:attachmentId/content',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const { content, filename, mimeType } = await readAttachmentContent(request.params.attachmentId);
        reply.header('Content-Type', mimeType);
        reply.header('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
        reply.header('Cache-Control', 'private, max-age=3600');
        return reply.send(content);
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );
}
