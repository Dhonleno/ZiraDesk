import type { FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import type { Tenant, PlanFeature } from '@ziradesk/shared';

declare module 'fastify' {
  interface FastifyRequest {
    tenant: Tenant;
  }
}

type TenantWithPlan = Prisma.TenantGetPayload<{
  include: { plan: { select: { features: true; maxMessages: true } } };
}>;

const TENANT_CACHE_TTL = 60;

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

  let tenant: TenantWithPlan | null = null;

  const cacheKey = `tenant:slug:${subdomain}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      tenant = JSON.parse(cached) as TenantWithPlan;
    }
  } catch {
    // Redis indisponível — continua sem cache
  }

  if (!tenant) {
    tenant = await prisma.tenant.findUnique({
      where: { slug: subdomain },
      include: {
        plan: {
          select: { features: true, maxMessages: true },
        },
      },
    });

    if (tenant) {
      try {
        await redis.set(cacheKey, JSON.stringify(tenant), 'EX', TENANT_CACHE_TTL);
      } catch {
        // Redis indisponível — segue sem cachear
      }
    }
  }

  if (!tenant) {
    return reply.code(404).send({ error: 'Tenant não encontrado' });
  }

  if (tenant.status !== 'active' && tenant.status !== 'trial') {
    return reply.code(402).send({ error: 'Conta suspensa ou cancelada' });
  }

  request.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    schemaName: tenant.schemaName,
    planId: tenant.planId,
    status: tenant.status as Tenant['status'],
    trialEndsAt: tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null,
    settings: tenant.settings as Record<string, unknown>,
    createdAt: new Date(tenant.createdAt),
    ...(tenant.plan && {
      plan: {
        features: (tenant.plan.features ?? {}) as Partial<Record<PlanFeature, boolean>>,
        maxMessages: tenant.plan.maxMessages ?? -1,
      },
    }),
  };
}
