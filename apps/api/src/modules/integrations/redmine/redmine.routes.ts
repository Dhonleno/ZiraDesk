import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../config/database.js';
import { logger } from '../../../config/logger.js';
import { handleRedmineWebhook, type RedmineWebhookPayload } from './redmine.service.js';

export async function redmineWebhookRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/webhooks/redmine/:tenantSlug
  // Webhook público sem JWT
  app.post<{ Params: { tenantSlug: string } }>('/webhooks/redmine/:tenantSlug', async (request, reply) => {
    const { tenantSlug } = request.params;

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, schemaName: true, status: true },
    });

    if (!tenant || (tenant.status !== 'active' && tenant.status !== 'trial')) {
      return reply.code(404).send({ success: false, error: { message: 'Tenant não encontrado' } });
    }

    const payload = (request.body ?? {}) as RedmineWebhookPayload;

    void handleRedmineWebhook(tenant.id, tenant.schemaName, payload).catch((err) => {
      logger.error({ err, tenantSlug }, '[Redmine] Webhook handler error');
    });

    return reply.code(200).send({ ok: true });
  });
}
