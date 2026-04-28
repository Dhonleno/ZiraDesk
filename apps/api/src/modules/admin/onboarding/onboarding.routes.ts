import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { getOnboardingStatus } from './onboarding.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/onboarding-status', { preHandler: guard }, async (request, reply) => {
    const data = await getOnboardingStatus(request.user.tenantId!);
    return reply.send({ success: true, data });
  });
}
