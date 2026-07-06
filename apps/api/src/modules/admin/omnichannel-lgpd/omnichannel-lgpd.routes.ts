import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { ensureCrmInfrastructureMiddleware } from '../../crm/crm.infrastructure.js';
import {
  anonymizeByExternalId,
  listExternalLgpdRequests,
  ExternalIdNotFoundError,
  AlreadyAnonymizedError,
} from '../../omnichannel/conversations/conversations.lgpd.service.js';

const guard = [
  authMiddleware,
  tenantSchemaFromJwt,
  ensureCrmInfrastructureMiddleware,
  requirePermission('lgpd:manage'),
];

const anonymizeByExternalIdSchema = z.object({
  external_id: z.string().min(1).max(255),
  reason: z.string().min(1).max(500),
});

const listExternalRequestsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().max(30).optional(),
});

export async function omnichannelLgpdRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/admin/omnichannel/conversations/anonymize-by-external-id
  app.post('/conversations/anonymize-by-external-id', { preHandler: guard }, async (request, reply) => {
    const parsed = anonymizeByExternalIdSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    try {
      const result = await anonymizeByExternalId(
        parsed.data.external_id,
        parsed.data.reason,
        request.user.id,
        schemaName,
      );
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof ExternalIdNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof AlreadyAnonymizedError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // GET /api/admin/omnichannel/conversations/external-requests
  app.get('/conversations/external-requests', { preHandler: guard }, async (request, reply) => {
    const parsed = listExternalRequestsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const result = await listExternalLgpdRequests(
      { page: parsed.data.page, per_page: parsed.data.per_page, status: parsed.data.status },
      schemaName,
    );
    return reply.send({ success: true, ...result });
  });
}
