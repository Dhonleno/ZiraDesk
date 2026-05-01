import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { createContactSchema, updateContactSchema, listContactsQuerySchema, linkOrganizationSchema } from './contacts.schema.js';
import {
  listContacts,
  getContact,
  getContactStats,
  createContact,
  updateContact,
  deleteContact,
  linkToOrganization,
  NotFoundError,
  ConflictError,
} from './contacts.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent')];

export async function contactsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/crm/contacts
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const parsed = listContactsQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    const result = await listContacts(parsed.data);
    return reply.send({ success: true, ...result });
  });

  // POST /api/crm/contacts
  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = createContactSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    try {
      const contact = await createContact(parsed.data, request.user.id);
      return reply.code(201).send({ success: true, data: contact });
    } catch (err) {
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/contacts/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const contact = await getContact(request.params.id);
      return reply.send({ success: true, data: contact });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/contacts/:id/stats
  app.get<{ Params: { id: string } }>(
    '/:id/stats',
    { preHandler: guard },
    async (request, reply) => {
      try {
        const stats = await getContactStats(request.params.id);
        return reply.send({ success: true, data: stats });
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // PATCH /api/crm/contacts/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateContactSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    try {
      const contact = await updateContact(request.params.id, parsed.data, request.user.id);
      return reply.send({ success: true, data: contact });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/crm/contacts/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const contact = await deleteContact(request.params.id, request.user.id);
      return reply.send({ success: true, data: contact });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/crm/contacts/:id/link-organization
  app.post<{ Params: { id: string } }>('/:id/link-organization', { preHandler: guard }, async (request, reply) => {
    const parsed = linkOrganizationSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    try {
      const contact = await linkToOrganization(request.params.id, parsed.data.organization_id, request.user.id);
      return reply.send({ success: true, data: contact });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });
}
