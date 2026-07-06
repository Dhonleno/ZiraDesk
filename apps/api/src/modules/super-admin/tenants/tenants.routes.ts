import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../config/database.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { getUsageSummary } from '../../../services/usage.service.js';
import {
  createTenantSchema,
  updateTenantSchema,
  listTenantsQuerySchema,
  slugAvailabilityQuerySchema,
  superAdminTenantUsersQuerySchema,
  superAdminTenantInviteUserSchema,
} from './tenants.schema.js';
import {
  createTenant,
  listTenants,
  checkTenantSlugAvailability,
  getTenant,
  updateTenant,
  deleteTenant,
  suspendTenant,
  activateTenant,
  getSuperAdminTenantStats,
  impersonateTenantAsAdmin,
  listTenantUsersForSuperAdmin,
  inviteTenantUserAsSuperAdmin,
  resetTenantUserPasswordAsSuperAdmin,
  NotFoundError,
  ConflictError,
} from './tenants.service.js';
import {
  ConflictError as UsersConflictError,
  NotFoundError as UsersNotFoundError,
  PlanLimitError,
} from '../../admin/users/users.service.js';

const guard = [authMiddleware, hasRole('super_admin')];

export async function tenantsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/check-slug', { preHandler: guard }, async (request, reply) => {
    const parsed = slugAvailabilityQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    }

    const result = await checkTenantSlugAvailability(parsed.data);
    return reply.send({ success: true, data: result });
  });

  app.get('/stats', { preHandler: guard }, async (_request, reply) => {
    const stats = await getSuperAdminTenantStats();
    return reply.send({ success: true, data: stats });
  });

  app.get<{ Params: { id: string }; Querystring: { period?: string } }>(
    '/:id/usage',
    { preHandler: guard },
    async (request, reply) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: request.params.id },
        select: { plan: { select: { maxMessages: true, maxUsers: true, maxContacts: true } } },
      });
      if (!tenant) {
        return reply.code(404).send({ success: false, error: { message: 'Tenant não encontrado' } });
      }
      if (!tenant.plan) {
        return reply.code(422).send({ success: false, error: { message: 'Tenant sem plano' } });
      }

      const data = await getUsageSummary(request.params.id, tenant.plan, request.query.period);
      return reply.send({ success: true, data });
    },
  );

  app.get('/', { preHandler: guard }, async (request, reply) => {
    const parsed = listTenantsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    }
    const result = await listTenants(parsed.data);
    return reply.send({ success: true, ...result });
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      const tenant = await getTenant(request.params.id);
      return reply.send({ success: true, data: tenant });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post('/', { preHandler: guard }, async (request, reply) => {
    const parsed = createTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }
    try {
      const result = await createTenant(parsed.data);
      return reply.code(201).send({ success: true, data: result });
    } catch (err) {
      if (err instanceof ConflictError) return reply.code(409).send({ success: false, error: { message: err.message } });
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = updateTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }
    try {
      const tenant = await updateTenant(request.params.id, parsed.data);
      return reply.send({ success: true, data: tenant });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: guard }, async (request, reply) => {
    try {
      await deleteTenant(request.params.id);
      return reply.send({ success: true, data: { message: 'Tenant cancelado' } });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/suspend', { preHandler: guard }, async (request, reply) => {
    try {
      const tenant = await suspendTenant(request.params.id);
      return reply.send({ success: true, data: tenant });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/activate', { preHandler: guard }, async (request, reply) => {
    try {
      const tenant = await activateTenant(request.params.id);
      return reply.send({ success: true, data: tenant });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/impersonate', { preHandler: guard }, async (request, reply) => {
    try {
      const result = await impersonateTenantAsAdmin(request.params.id, request.user.id);
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ConflictError) return reply.code(409).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/:id/users', { preHandler: guard }, async (request, reply) => {
    const parsed = superAdminTenantUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    }

    try {
      const result = await listTenantUsersForSuperAdmin(request.params.id, parsed.data);
      return reply.send({ success: true, ...result });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/users', { preHandler: guard }, async (request, reply) => {
    const parsed = superAdminTenantInviteUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }

    try {
      const result = await inviteTenantUserAsSuperAdmin(request.params.id, parsed.data);
      return reply.code(201).send({ success: true, data: result });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof UsersConflictError || err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof PlanLimitError) return reply.code(402).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post<{ Params: { id: string; userId: string } }>(
    '/:id/users/:userId/reset-password',
    { preHandler: guard },
    async (request, reply) => {
      try {
        await resetTenantUserPasswordAsSuperAdmin(request.params.id, request.params.userId);
        return reply.send({ success: true, data: { message: 'E-mail de redefinição enviado' } });
      } catch (err) {
        if (err instanceof NotFoundError || err instanceof UsersNotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );
}
