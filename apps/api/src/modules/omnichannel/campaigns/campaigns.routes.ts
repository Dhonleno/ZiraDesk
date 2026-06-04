import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  listCampaignsQuerySchema,
  createCampaignBodySchema,
  updateCampaignBodySchema,
  addContactsBodySchema,
} from './campaigns.schema.js';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  addContacts,
  removeContact,
  listCampaignContacts,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  duplicateCampaign,
  getCampaignReport,
  NotFoundError,
  ValidationError,
} from './campaigns.service.js';
import { ensureCampaignsInfrastructure } from './campaigns.infrastructure.js';
import { campaignSendQueue } from '../../../jobs/queue.js';

const guard = [authMiddleware, tenantSchemaFromJwt];
const replyGuard = [...guard, requirePermission('conversations:reply')];
const manageGuard = [...guard, requirePermission('conversations:manage')];

export async function omnichannelCampaignsRoutes(app: FastifyInstance): Promise<void> {
  // Ensure campaigns tables exist for every request
  app.addHook('preHandler', async (request) => {
    const schemaName = request.user?.schemaName;
    if (schemaName) {
      await ensureCampaignsInfrastructure(schemaName).catch(() => undefined);
    }
  });

  // GET /api/omnichannel/campaigns
  app.get('/', { preHandler: replyGuard }, async (request, reply) => {
    const parsed = listCampaignsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    }
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    const result = await listCampaigns(parsed.data, schemaName);
    return reply.send({ success: true, ...result });
  });

  // POST /api/omnichannel/campaigns
  app.post('/', { preHandler: replyGuard }, async (request, reply) => {
    const parsed = createCampaignBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const campaign = await createCampaign(parsed.data, request.user.id, schemaName);
      return reply.code(201).send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // GET /api/omnichannel/campaigns/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const campaign = await getCampaign(request.params.id, schemaName);
      return reply.send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // PATCH /api/omnichannel/campaigns/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: replyGuard }, async (request, reply) => {
    const parsed = updateCampaignBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const campaign = await updateCampaign(request.params.id, parsed.data, schemaName);
      return reply.send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ValidationError) return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/omnichannel/campaigns/:id/contacts
  app.post<{ Params: { id: string } }>('/:id/contacts', { preHandler: replyGuard }, async (request, reply) => {
    const parsed = addContactsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos', details: parsed.error.flatten() } });
    }
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const result = await addContacts(request.params.id, parsed.data, schemaName);
      return reply.code(201).send({ success: true, data: result });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ValidationError) return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/omnichannel/campaigns/:id/contacts/:contactId
  app.delete<{ Params: { id: string; contactId: string } }>(
    '/:id/contacts/:contactId',
    { preHandler: replyGuard },
    async (request, reply) => {
      const schemaName = request.user.schemaName;
      if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

      try {
        await removeContact(request.params.id, request.params.contactId, schemaName);
        return reply.send({ success: true });
      } catch (err) {
        if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
        if (err instanceof ValidationError) return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // GET /api/omnichannel/campaigns/:id/contacts
  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    '/:id/contacts',
    { preHandler: replyGuard },
    async (request, reply) => {
      const schemaName = request.user.schemaName;
      if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

      const page = Math.max(1, parseInt(String(request.query.page ?? '1'), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(request.query.limit ?? '50'), 10)));

      try {
        const result = await listCampaignContacts(request.params.id, schemaName, page, limit);
        return reply.send({ success: true, ...result });
      } catch (err) {
        if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // POST /api/omnichannel/campaigns/:id/launch
  app.post<{ Params: { id: string } }>('/:id/launch', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    const tenantId = request.user.tenantId;
    if (!schemaName || !tenantId) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const campaign = await launchCampaign(request.params.id, request.user.id, schemaName);

      if (campaign.status === 'running') {
        await campaignSendQueue.add('send', {
          campaignId: campaign.id,
          tenantId,
          schemaName,
        }, { jobId: `campaign-send-${campaign.id}-${Date.now()}` });
      }

      return reply.send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ValidationError) return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/omnichannel/campaigns/:id/pause
  app.post<{ Params: { id: string } }>('/:id/pause', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const campaign = await pauseCampaign(request.params.id, request.user.id, schemaName);
      return reply.send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ValidationError) return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/omnichannel/campaigns/:id/resume
  app.post<{ Params: { id: string } }>('/:id/resume', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    const tenantId = request.user.tenantId;
    if (!schemaName || !tenantId) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const campaign = await resumeCampaign(request.params.id, request.user.id, schemaName);

      await campaignSendQueue.add('send', {
        campaignId: campaign.id,
        tenantId,
        schemaName,
      }, { jobId: `campaign-send-${campaign.id}-${Date.now()}` });

      return reply.send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ValidationError) return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/omnichannel/campaigns/:id/cancel
  app.post<{ Params: { id: string } }>('/:id/cancel', { preHandler: manageGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const campaign = await cancelCampaign(request.params.id, request.user.id, schemaName);
      return reply.send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ValidationError) return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/omnichannel/campaigns/:id/duplicate
  app.post<{ Params: { id: string } }>('/:id/duplicate', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const campaign = await duplicateCampaign(request.params.id, request.user.id, schemaName);
      return reply.code(201).send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/omnichannel/campaigns/:id/report
  app.get<{ Params: { id: string } }>('/:id/report', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const report = await getCampaignReport(request.params.id, schemaName);
      return reply.send({ success: true, data: report });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

}
