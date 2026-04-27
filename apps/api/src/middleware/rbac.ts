import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@ziradesk/shared';

type AllowedRole = UserRole;

/**
 * Retorna um preHandler que verifica se o usuário autenticado possui
 * ao menos um dos roles permitidos. Deve ser usado após authMiddleware.
 */
export function hasRole(...allowedRoles: AllowedRole[]) {
  return async function rbacHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const user = request.user;

    if (!user) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }

    if (!allowedRoles.includes(user.role as AllowedRole)) {
      return reply.code(403).send({ error: 'Permissão insuficiente' });
    }
  };
}
