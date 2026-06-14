import type { FastifyInstance } from 'fastify';
import { hasPermission } from '@ziradesk/shared';
import { authMiddleware } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { ensureCrmInfrastructureMiddleware } from '../crm.infrastructure.js';
import {
  bulkDeleteOrganizationsSchema,
  countOrganizationsQuerySchema,
  createOrganizationSchema,
  updateOrganizationSchema,
  listOrganizationsQuerySchema,
} from './organizations.schema.js';
import {
  listOrganizations,
  countOrganizationsByFilter,
  maskOrganizationContactRecords,
  maskOrganizationListRecords,
  getOrganization,
  getOrganizationStats,
  registerOrganizationPiiAccess,
  registerOrganizationPiiReveal,
  getOrganizationContacts,
  getOrganizationConversations,
  getOrganizationTickets,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  bulkDeleteOrganizations,
  NotFoundError,
  ConflictError,
} from './organizations.service.js';

const guard = [
  authMiddleware,
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
];
const organizationsViewGuard = [...guard, requirePermission('organizations:view')];
const organizationsEditGuard = [...guard, requirePermission('organizations:edit')];
const organizationsDeleteGuard = [...guard, requirePermission('organizations:delete')];
const organizationsPiiRevealGuard = [...guard, requirePermission('organizations:view'), requirePermission('pii:view-full')];

function canViewFullPii(role: string): boolean {
  return hasPermission(role as Parameters<typeof hasPermission>[0], 'pii:view-full');
}

export async function organizationsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/crm/organizations
  app.get('/', { preHandler: organizationsViewGuard }, async (request, reply) => {
    const parsed = listOrganizationsQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    const result = await listOrganizations(parsed.data, request.user.schemaName);
    const includeFullPii = canViewFullPii(request.user.role);
    return reply.send({
      success: true,
      ...result,
      data: includeFullPii ? result.data : maskOrganizationListRecords(result.data),
    });
  });

  // GET /api/crm/organizations/count
  app.get('/count', { preHandler: organizationsViewGuard }, async (request, reply) => {
    const parsed = countOrganizationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const count = await countOrganizationsByFilter(parsed.data, request.user.schemaName);
    return reply.send({ count });
  });

  // POST /api/crm/organizations
  app.post('/', { preHandler: organizationsEditGuard }, async (request, reply) => {
    const parsed = createOrganizationSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    try {
      const org = await createOrganization(parsed.data, request.user.id, request.user.schemaName);
      return reply.code(201).send({ success: true, data: org });
    } catch (err) {
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/crm/organizations/bulk-delete
  app.post('/bulk-delete', { preHandler: organizationsDeleteGuard }, async (request, reply) => {
    const parsed = bulkDeleteOrganizationsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const result = await bulkDeleteOrganizations(
      parsed.data,
      request.user.id,
      request.user.schemaName,
    );
    return reply.send({ success: true, data: result });
  });

  // GET /api/crm/organizations/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: organizationsViewGuard }, async (request, reply) => {
    try {
      const org = await getOrganization(request.params.id, request.user.schemaName);
      await registerOrganizationPiiAccess(org.id, request.user.id, request.user.schemaName);
      return reply.send({ success: true, data: org });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // PATCH /api/crm/organizations/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: organizationsEditGuard }, async (request, reply) => {
    const parsed = updateOrganizationSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    try {
      const org = await updateOrganization(request.params.id, parsed.data, request.user.id, request.user.schemaName);
      return reply.send({ success: true, data: org });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/crm/organizations/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: organizationsDeleteGuard }, async (request, reply) => {
    try {
      const org = await deleteOrganization(request.params.id, request.user.id, request.user.schemaName);
      return reply.send({ success: true, data: org });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/organizations/:id/stats
  app.get<{ Params: { id: string } }>('/:id/stats', { preHandler: organizationsViewGuard }, async (request, reply) => {
    try {
      const stats = await getOrganizationStats(request.params.id, request.user.schemaName);
      return reply.send({ success: true, data: stats });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/organizations/:id/contacts
  app.get<{ Params: { id: string } }>('/:id/contacts', { preHandler: organizationsViewGuard }, async (request, reply) => {
    try {
      const contacts = await getOrganizationContacts(request.params.id, request.user.schemaName);
      const includeFullPii = canViewFullPii(request.user.role);
      return reply.send({
        success: true,
        data: includeFullPii ? contacts : maskOrganizationContactRecords(contacts),
      });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/organizations/:id/conversations
  app.get<{ Params: { id: string } }>('/:id/conversations', { preHandler: organizationsViewGuard }, async (request, reply) => {
    try {
      const convs = await getOrganizationConversations(request.params.id, request.user.schemaName);
      return reply.send({ success: true, data: convs });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/crm/organizations/:id/tickets
  app.get<{ Params: { id: string } }>('/:id/tickets', { preHandler: organizationsViewGuard }, async (request, reply) => {
    try {
      const tickets = await getOrganizationTickets(request.params.id, request.user.schemaName);
      return reply.send({ success: true, data: tickets });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/crm/organizations/:id/pii/reveal
  app.post<{ Params: { id: string } }>('/:id/pii/reveal', { preHandler: organizationsPiiRevealGuard }, async (request, reply) => {
    try {
      await registerOrganizationPiiReveal(
        request.params.id,
        request.user.id,
        request.user.schemaName,
        undefined,
        { ip: request.ip, userAgent: request.headers['user-agent'] },
      );
      const org = await getOrganization(request.params.id, request.user.schemaName);
      return reply.send({ success: true, data: org });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });
}
