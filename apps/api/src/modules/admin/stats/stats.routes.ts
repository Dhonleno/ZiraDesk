import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../config/database.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { requireFeature } from '../../../middleware/entitlement.js';
import { hasRole, requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { getUsageSummary } from '../../../services/usage.service.js';
import { ensureCrmInfrastructureMiddleware } from '../../crm/crm.infrastructure.js';
import { getOverview } from './stats.service.js';

const guard = [
  authMiddleware,
  requireFeature('reports'),
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
  requirePermission('metrics:view'),
];
const usageGuard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin', 'agent', 'viewer')];

export async function registerUsageRoute(app: FastifyInstance): Promise<void> {
  app.get('/usage', { preHandler: usageGuard }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.code(401).send({ success: false, error: { message: 'Token inválido: tenantId ausente' } });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: { select: { maxMessages: true, maxUsers: true, maxContacts: true } } },
    });
    if (!tenant?.plan) {
      return reply.code(404).send({ success: false, error: { message: 'Plano não encontrado' } });
    }

    const data = await getUsageSummary(tenantId, tenant.plan);
    return reply.send({ success: true, data });
  });
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/overview', { preHandler: guard }, async (_request, reply) => {
    const data = await getOverview();
    return reply.send({ success: true, data });
  });

  await registerUsageRoute(app);
}
