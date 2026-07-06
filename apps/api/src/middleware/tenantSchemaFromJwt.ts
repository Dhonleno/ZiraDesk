import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';

export async function tenantSchemaFromJwt(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user;
  const resolvedTenant = (request as FastifyRequest & { tenant?: { id: string; schemaName: string } }).tenant;

  if (!user || user.isSuperAdmin) {
    return reply.code(403).send({ error: 'Acesso não permitido' });
  }

  if (!user.tenantId) {
    return reply.code(401).send({ error: 'Token inválido: tenantId ausente' });
  }

  if (resolvedTenant && resolvedTenant.id !== user.tenantId) {
    return reply.code(403).send({ error: 'Acesso cross-tenant não permitido' });
  }

  // Fast path: schemaName already in JWT (tokens issued after this deploy)
  if (user.schemaName) {
    const schemaName = resolvedTenant?.schemaName ?? user.schemaName;
    await prisma.$executeRawUnsafe(`SET search_path TO "${schemaName}", public`);
    request.user = {
      ...user,
      schemaName,
    };
    return;
  }

  // Fallback: lookup DB for tokens issued before schemaName was added to JWT
  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { schemaName: true, status: true },
  });

  if (!tenant) {
    return reply.code(404).send({ error: 'Tenant não encontrado' });
  }

  if (tenant.status !== 'active' && tenant.status !== 'trial') {
    return reply.code(403).send({ error: 'Conta suspensa ou cancelada' });
  }

  request.user = {
    ...user,
    schemaName: tenant.schemaName,
  };
  await prisma.$executeRawUnsafe(`SET search_path TO "${tenant.schemaName}", public`);
}
