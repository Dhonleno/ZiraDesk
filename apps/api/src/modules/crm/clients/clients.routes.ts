import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  createClientSchema,
  updateClientSchema,
  listClientsQuerySchema,
  tagBodySchema,
} from './clients.schema.js';
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  getClientTimeline,
  getClientStats,
  addTag,
  removeTag,
  NotFoundError,
  ConflictError,
} from './clients.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent')];

export async function clientsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/crm/clients
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const parsed = listClientsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    const result = await listClients(parsed.data);
    return reply.send({ success: true, ...result });
  });

  // POST /api/crm/clients
  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = createClientSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const client = await createClient(parsed.data, request.user.id);
      return reply.code(201).send({ success: true, data: client });
    } catch (err) {
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/clients/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const client = await getClient(request.params.id);
      return reply.send({ success: true, data: client });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // PATCH /api/crm/clients/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateClientSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const client = await updateClient(request.params.id, parsed.data, request.user.id);
      return reply.send({ success: true, data: client });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/crm/clients/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const client = await deleteClient(request.params.id, request.user.id);
      return reply.send({ success: true, data: client });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/clients/:id/timeline
  app.get<{ Params: { id: string } }>(
    '/:id/timeline',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const timeline = await getClientTimeline(request.params.id);
        return reply.send({ success: true, data: timeline });
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // GET /api/crm/clients/:id/stats
  app.get<{ Params: { id: string } }>(
    '/:id/stats',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const stats = await getClientStats(request.params.id, request.user.tenantId);
        return reply.send({ success: true, data: stats });
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // POST /api/crm/clients/:id/tags
  app.post<{ Params: { id: string } }>(
    '/:id/tags',
    { preHandler: guard },
    async (request, reply) => {
      const parsed = tagBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }
      try {
        const client = await addTag(request.params.id, parsed.data.tag);
        return reply.send({ success: true, data: client });
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // DELETE /api/crm/clients/:id/tags/:tag
  app.delete<{ Params: { id: string; tag: string } }>(
    '/:id/tags/:tag',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const client = await removeTag(request.params.id, request.params.tag);
        return reply.send({ success: true, data: client });
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );
}
