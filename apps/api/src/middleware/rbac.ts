import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Permission, Role } from '@ziradesk/shared';
import { hasPermission } from '@ziradesk/shared';

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    }

    const role = user.role as Role;
    if (!hasPermission(role, permission)) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Permissão insuficiente' },
      });
    }
  };
}

export function requireAnyPermission(...permissions: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = request.user?.role as Role;
    if (!role) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    }

    const allowed = permissions.some((permission) => hasPermission(role, permission));
    if (!allowed) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Permissão insuficiente' },
      });
    }
  };
}

// Compatibilidade com módulos ainda não migrados para permissões.
export function hasRole(...allowedRoles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = request.user?.role as Role | undefined;
    if (!role) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    }

    if (!allowedRoles.includes(role)) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Permissão insuficiente' },
      });
    }
  };
}
