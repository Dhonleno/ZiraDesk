import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';
import type { Tenant, PlanFeature } from '@ziradesk/shared';

declare module 'fastify' {
  interface FastifyRequest {
    tenant: Tenant;
  }
}

export async function tenantMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const host = request.headers.host ?? '';
  // Extrai o subdomínio: "acme.ziradesk.com" → "acme"
  const subdomain = host.split('.')[0] ?? '';

  if (!subdomain || subdomain === 'www' || subdomain === 'api') {
    return reply.code(400).send({ error: 'Tenant não identificado' });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: subdomain },
    include: {
      plan: {
        select: { features: true, maxMessages: true },
      },
    },
  });

  if (!tenant) {
    return reply.code(404).send({ error: 'Tenant não encontrado' });
  }

  if (tenant.status !== 'active' && tenant.status !== 'trial') {
    return reply.code(402).send({ error: 'Conta suspensa ou cancelada' });
  }

  // Redireciona as queries do Prisma para o schema isolado do tenant
  // O SET é feito via $executeRawUnsafe na conexão da requisição
  await prisma.$executeRawUnsafe(`SET search_path TO "${tenant.schemaName}", public`);

  request.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    schemaName: tenant.schemaName,
    planId: tenant.planId,
    status: tenant.status as Tenant['status'],
    trialEndsAt: tenant.trialEndsAt,
    settings: tenant.settings as Record<string, unknown>,
    createdAt: tenant.createdAt,
    ...(tenant.plan && {
      plan: {
        features: (tenant.plan.features ?? {}) as Partial<Record<PlanFeature, boolean>>,
        maxMessages: tenant.plan.maxMessages ?? -1,
      },
    }),
  };
}
