import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { authMiddleware } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  inviteUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  updateUserLgpdConsentSchema,
  exportUserLgpdQuerySchema,
  anonymizeUserLgpdSchema,
  listUserLgpdRequestsQuerySchema,
} from './users.schema.js';
import {
  listUsers,
  getUser,
  inviteUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  generateProvisionalPassword,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  PlanLimitError,
  RoleUpdateError,
  InviteEmailError,
} from './users.service.js';
import {
  updateUserLgpdConsent,
  exportUserLgpdData,
  anonymizeUserForLgpd,
  listUserLgpdRequests,
  NotFoundError as LgpdNotFoundError,
  ForbiddenError as LgpdForbiddenError,
} from './users.lgpd.service.js';
import { ensureUsersLgpdInfrastructure } from './users.infrastructure.js';

const guard = [authMiddleware, tenantSchemaFromJwt];
const usersManageGuard = [...guard, requirePermission('users:manage')];
const lgpdManageGuard = [...guard, requirePermission('lgpd:manage')];

function resolveSchemaName(request: FastifyRequest): string | null {
  const authUser = request.user as AuthUser;
  return authUser.schemaName ?? null;
}

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = listUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    const result = await listUsers(parsed.data, schemaName);
    return reply.send({ success: true, ...result });
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: usersManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    try {
      const user = await getUser(request.params.id, schemaName);
      return reply.send({ success: true, data: user });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post('/invite', { preHandler: usersManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = inviteUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const result = await inviteUser(parsed.data, request.user.tenantId!, schemaName);
      return reply.code(201).send({ success: true, data: result });
    } catch (err) {
      if (err instanceof InviteEmailError) {
        return reply.code(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      if (err instanceof PlanLimitError)
        return reply.code(402).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: usersManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const authUser = request.user as AuthUser;
      const user = await updateUser(
        request.params.id,
        parsed.data,
        schemaName,
        { id: authUser.id, role: authUser.role },
      );
      return reply.send({ success: true, data: user });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof RoleUpdateError) {
        return reply.code(403).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/reset-password', { preHandler: usersManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.code(500).send({ success: false, error: { message: 'Tenant não identificado' } });
    }

    try {
      await resetUserPassword(request.params.id, tenantId, schemaName);
      return reply.send({ success: true, data: { message: 'E-mail de redefinição enviado' } });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ForbiddenError)
        return reply.code(403).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/provisional-password', { preHandler: usersManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    try {
      const result = await generateProvisionalPassword(request.params.id, request.user.id, schemaName);
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ForbiddenError)
        return reply.code(403).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: usersManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Schema do tenant não resolvido' },
      });
    }

    try {
      const user = await deleteUser(request.params.id, request.user.id, schemaName);
      return reply.send({ success: true, data: user });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ForbiddenError)
        return reply.code(403).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id/lgpd/consent', { preHandler: lgpdManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const parsed = updateUserLgpdConsentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });

    await ensureUsersLgpdInfrastructure(schemaName);
    try {
      const result = await updateUserLgpdConsent(request.params.id, parsed.data, request.user.id, schemaName);
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof LgpdNotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof LgpdForbiddenError) return reply.code(403).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/:id/lgpd/export', { preHandler: lgpdManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const parsed = exportUserLgpdQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { message: 'Query inválida' } });

    await ensureUsersLgpdInfrastructure(schemaName);
    try {
      const data = await exportUserLgpdData(request.params.id, request.user.id, { includeAuditLogs: parsed.data.include_audit_logs }, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof LgpdNotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/lgpd/anonymize', { preHandler: lgpdManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const parsed = anonymizeUserLgpdSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { message: 'Dados inválidos' } });

    await ensureUsersLgpdInfrastructure(schemaName);
    try {
      const result = await anonymizeUserForLgpd(request.params.id, request.user.id, parsed.data, request.user.id, schemaName);
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof LgpdNotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof LgpdForbiddenError) return reply.code(403).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.get('/lgpd/requests', { preHandler: lgpdManageGuard }, async (request, reply) => {
    const schemaName = resolveSchemaName(request);
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const parsed = listUserLgpdRequestsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { message: 'Query inválida' } });

    await ensureUsersLgpdInfrastructure(schemaName);
    const result = await listUserLgpdRequests(parsed.data, schemaName);
    return reply.send({ success: true, ...result });
  });
}
