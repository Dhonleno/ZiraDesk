import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { createTicketCategorySchema, updateTicketCategorySchema } from './ticket-categories.schema.js';
import {
  listTicketCategories,
  createTicketCategory,
  updateTicketCategory,
  deleteTicketCategory,
  NotFoundError,
  ConflictError,
} from './ticket-categories.service.js';

const readGuard  = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent')];
const writeGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function ticketCategoriesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/ticket-categories
  app.get('/', { preHandler: readGuard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const data = await listTicketCategories(schemaName);
    return reply.send({ success: true, data });
  });

  // POST /api/admin/ticket-categories
  app.post('/', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createTicketCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }

    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const data = await createTicketCategory(parsed.data, schemaName);
    return reply.code(201).send({ success: true, data });
  });

  // PATCH /api/admin/ticket-categories/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = updateTicketCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }

    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    try {
      const data = await updateTicketCategory(request.params.id, parsed.data, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/admin/ticket-categories/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: writeGuard }, async (request, reply) => {
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    try {
      const data = await deleteTicketCategory(request.params.id, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ConflictError) return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });
}
