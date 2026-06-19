import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PlanFeature } from '@ziradesk/shared';

export function requireFeature(feature: PlanFeature) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if ((request.user as { isSuperAdmin?: boolean })?.isSuperAdmin) return;

    const tenant = request.tenant;

    if (!tenant?.plan) {
      const user = request.user;
      if (!user?.tenantId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Tenant não identificado' },
        });
      }

      const { prisma } = await import('../config/database.js');
      const tenantRecord = await prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { plan: { select: { features: true } } },
      });

      const features = (tenantRecord?.plan?.features ?? {}) as Partial<Record<PlanFeature, boolean>>;

      if (!features[feature]) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FEATURE_NOT_AVAILABLE',
            message: 'Esta funcionalidade não está disponível no seu plano atual.',
            feature,
          },
        });
      }
      return;
    }

    if (!tenant.plan.features[feature]) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'FEATURE_NOT_AVAILABLE',
          message: 'Esta funcionalidade não está disponível no seu plano atual.',
          feature,
        },
      });
    }
  };
}

export function hasFeature(
  features: Partial<Record<PlanFeature, boolean>> | undefined,
  feature: PlanFeature,
): boolean {
  return features?.[feature] === true;
}
