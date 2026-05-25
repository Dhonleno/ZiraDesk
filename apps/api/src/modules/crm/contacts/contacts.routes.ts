import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { ensureCrmInfrastructureMiddleware } from '../crm.infrastructure.js';
import {
  createContactSchema,
  updateContactSchema,
  listContactsQuerySchema,
  linkOrganizationSchema,
  updateContactLgpdConsentSchema,
  exportContactLgpdQuerySchema,
  anonymizeContactLgpdSchema,
  listLgpdRequestsQuerySchema,
} from './contacts.schema.js';
import {
  listContacts,
  listLgpdRequests,
  getContact,
  getContactStats,
  createContact,
  updateContact,
  deleteContact,
  linkToOrganization,
  updateContactLgpdConsent,
  exportContactLgpdData,
  anonymizeContactForLgpd,
  createPortalAccess,
  revokePortalAccess,
  NotFoundError,
  ConflictError,
  PlanLimitError,
} from './contacts.service.js';

const guard = [
  authMiddleware,
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
];
const contactsViewGuard = [...guard, requirePermission('contacts:view')];
const contactsEditGuard = [...guard, requirePermission('contacts:edit')];
const contactsDeleteGuard = [...guard, requirePermission('contacts:delete')];
const contactsLgpdGuard = [...guard, requirePermission('lgpd:manage')];
const managePortalGuard = [...guard, requirePermission('contacts:edit')];

export async function contactsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/crm/contacts
  app.get('/', { preHandler: contactsViewGuard }, async (request, reply) => {
    const parsed = listContactsQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    const result = await listContacts(parsed.data, request.user.schemaName);
    return reply.send({ success: true, ...result });
  });

  // GET /api/crm/contacts/lgpd/requests
  app.get('/lgpd/requests', { preHandler: contactsLgpdGuard }, async (request, reply) => {
    const parsed = listLgpdRequestsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    }

    const result = await listLgpdRequests(parsed.data, request.user.schemaName);
    return reply.send({ success: true, ...result });
  });

  // POST /api/crm/contacts
  app.post('/', { preHandler: contactsEditGuard }, async (request, reply) => {
    const parsed = createContactSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    try {
      const contact = await createContact(parsed.data, request.user.id, request.user.tenantId ?? undefined, request.user.schemaName);
      return reply.code(201).send({ success: true, data: contact });
    } catch (err) {
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      if (err instanceof PlanLimitError)
        return reply.code(402).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/contacts/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: contactsViewGuard }, async (request, reply) => {
    try {
      const contact = await getContact(request.params.id, request.user.schemaName);
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
    { preHandler: contactsViewGuard },
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
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: contactsEditGuard }, async (request, reply) => {
    const parsed = updateContactSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    try {
      const contact = await updateContact(request.params.id, parsed.data, request.user.id, request.user.schemaName);
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
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: contactsDeleteGuard }, async (request, reply) => {
    try {
      const contact = await deleteContact(request.params.id, request.user.id, request.user.schemaName);
      return reply.send({ success: true, data: contact });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // PATCH /api/crm/contacts/:id/lgpd/consent
  app.patch<{ Params: { id: string } }>('/:id/lgpd/consent', { preHandler: contactsLgpdGuard }, async (request, reply) => {
    const parsed = updateContactLgpdConsentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }

    try {
      const data = await updateContactLgpdConsent(
        request.params.id,
        parsed.data,
        request.user.id,
        request.user.schemaName,
      );
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // GET /api/crm/contacts/:id/lgpd/export
  app.get<{ Params: { id: string } }>('/:id/lgpd/export', { preHandler: contactsLgpdGuard }, async (request, reply) => {
    const parsed = exportContactLgpdQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    }

    try {
      const data = await exportContactLgpdData(
        request.params.id,
        request.user.id,
        { includeMessages: parsed.data.include_messages },
        request.user.schemaName,
      );
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/crm/contacts/:id/lgpd/anonymize
  app.post<{ Params: { id: string } }>('/:id/lgpd/anonymize', { preHandler: contactsLgpdGuard }, async (request, reply) => {
    const parsed = anonymizeContactLgpdSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }

    try {
      const data = await anonymizeContactForLgpd(
        request.params.id,
        request.user.id,
        parsed.data,
        request.user.schemaName,
      );
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/crm/contacts/:id/link-organization
  app.post<{ Params: { id: string } }>('/:id/link-organization', { preHandler: contactsEditGuard }, async (request, reply) => {
    const parsed = linkOrganizationSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    try {
      const contact = await linkToOrganization(request.params.id, parsed.data.organization_id, request.user.id, request.user.schemaName);
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
      const data = await createPortalAccess(request.params.id, request.user.tenantId, request.user.schemaName);

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
      const data = await revokePortalAccess(request.params.id, request.user.schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
