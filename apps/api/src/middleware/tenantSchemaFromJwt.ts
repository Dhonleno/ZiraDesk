import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';

export async function tenantSchemaFromJwt(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user;

  if (!user || user.isSuperAdmin) {
    return reply.code(403).send({ error: 'Acesso não permitido' });
  }

  if (!user.tenantId) {
    return reply.code(401).send({ error: 'Token inválido: tenantId ausente' });
  }

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

  await prisma.$executeRawUnsafe(`SET search_path TO "${tenant.schemaName}", public`);
}
