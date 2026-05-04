import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { hasRole } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import {
  createTicketSchema,
  updateTicketSchema,
  listTicketsQuerySchema,
  createCommentSchema,
  assignTicketSchema,
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
  deleteComment,
  getTicketTimeline,
  getStats,
  NotFoundError,
  ForbiddenError,
} from './tickets.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent')];

export async function ticketsRoutes(app: FastifyInstance): Promise<void> {
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
  app.delete<{ Params: { id: string; commentId: string } }>(
    '/:id/comments/:commentId',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const result = await deleteComment(
          request.params.commentId,
          request.user.id,
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
}
