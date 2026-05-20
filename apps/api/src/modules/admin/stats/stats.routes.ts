import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { ensureCrmInfrastructureMiddleware } from '../../crm/crm.infrastructure.js';
import { getOverview } from './stats.service.js';

const guard = [
  authMiddleware,
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
  requirePermission('metrics:view'),
];

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/overview', { preHandler: guard }, async (_request, reply) => {
    const data = await getOverview();
    return reply.send({ success: true, data });
  });
}
