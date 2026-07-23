import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';

// Permissão granular configurável por tenant (tenant.settings), distinta do
// RBAC estático de requirePermission (rbac.ts). Nome diferente de propósito:
// evita colidir com requirePermission(permission: Permission), que checa o
// mapa fixo de @ziradesk/shared — aqui o valor vem do banco, por tenant.
//
// owner/admin sempre passam. Demais roles (agent, supervisor, viewer) são
// avaliados contra tenant.settings[key]; ausência/undefined = permitido
// (o default real fica a cargo dos defaults aplicados em settings.service.ts
// ao ler/gravar — aqui só bloqueia quando o valor gravado é explicitamente false).
export function requireTenantPermission(key: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    }

    if (user.role === 'owner' || user.role === 'admin') return;

    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId! },
      select: { settings: true },
    });
    const settings = (tenant?.settings as Record<string, unknown>) ?? {};

    if (settings[key] === false) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Permissão insuficiente' },
      });
    }
  };
}
