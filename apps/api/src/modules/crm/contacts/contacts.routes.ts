import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { ensureCrmInfrastructureMiddleware } from '../crm.infrastructure.js';
import { createContactSchema, updateContactSchema, listContactsQuerySchema, linkOrganizationSchema } from './contacts.schema.js';
import {
  listContacts,
  getContact,
  getContactStats,
  createContact,
  updateContact,
  deleteContact,
  linkToOrganization,
  createPortalAccess,
  revokePortalAccess,
  NotFoundError,
  ConflictError,
} from './contacts.service.js';

const guard = [
  authMiddleware,
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
  hasRole('owner', 'admin', 'agent'),
];
const deleteGuard = [
  authMiddleware,
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
  hasRole('owner', 'admin'),
];
const managePortalGuard = [
  authMiddleware,
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
  hasRole('owner', 'admin'),
];

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
        const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
        if (!schemaName) {
          return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
        }

        const stats = await getContactStats(request.params.id, schemaName);
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
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/crm/contacts/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: deleteGuard }, async (request, reply) => {
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

  // POST /api/crm/contacts/:id/portal-access
  app.post<{ Params: { id: string } }>('/:id/portal-access', { preHandler: managePortalGuard }, async (request, reply) => {
    if (request.user.isSuperAdmin || !request.user.tenantId) {
      return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    }

    try {
      const data = await createPortalAccess(request.params.id, request.user.tenantId);

      request.log.info({
        event: 'portal.access.created',
        contact_id: data.contact.id,
        email: data.contact.email,
      }, 'Credenciais de acesso ao portal geradas');

      return reply.send({
        success: true,
        message: 'Acesso criado e e-mail enviado',
        data: {
          temp_password: data.tempPassword,
          portal_url: data.portalUrl,
          email: data.contact.email,
        },
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ConflictError) {
        return reply.code(400).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // DELETE /api/crm/contacts/:id/portal-access
  app.delete<{ Params: { id: string } }>('/:id/portal-access', { preHandler: managePortalGuard }, async (request, reply) => {
    try {
      const data = await revokePortalAccess(request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
