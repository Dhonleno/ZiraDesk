import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { requireFeature } from '../../../middleware/entitlement.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { requireTenantPermission } from '../../../middleware/tenantPermission.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import {
  listCampaignsQuerySchema,
  createCampaignBodySchema,
  updateCampaignBodySchema,
  addContactsBodySchema,
  duplicateFailedCampaignBodySchema,
} from './campaigns.schema.js';
import {
  listCampaigns,
  getCampaignStats,
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
  duplicateFailedCampaign,
  getCampaignReport,
  exportCampaignCsv,
  NotFoundError,
  ValidationError,
} from './campaigns.service.js';
import { exportCampaignPdf } from './campaign-pdf.service.js';
import { ensureCampaignsInfrastructure } from './campaigns.infrastructure.js';
import { campaignSendQueue } from '../../../jobs/queue.js';

const guard = [authMiddleware, requireFeature('whatsapp'), tenantSchemaFromJwt];
async function ensureCampaignsInfrastructureMiddleware(request: FastifyRequest): Promise<void> {
  const schemaName = request.user?.schemaName;
  if (schemaName) {
    await ensureCampaignsInfrastructure(schemaName);
  }
}

const replyGuard = [...guard, ensureCampaignsInfrastructureMiddleware, requirePermission('conversations:reply')];
const manageGuard = [...guard, ensureCampaignsInfrastructureMiddleware, requirePermission('conversations:manage')];
// Criar/editar campanha já funciona hoje via conversations:reply (todo agente
// tem essa permissão estática) — este guard adiciona uma trava por tenant em
// cima disso, default true para não regredir o comportamento atual.
const manageCampaignsGuard = [...replyGuard, requireTenantPermission('agent_can_manage_campaigns')];

export async function omnichannelCampaignsRoutes(app: FastifyInstance): Promise<void> {

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
  app.post('/', { preHandler: manageCampaignsGuard }, async (request, reply) => {
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

  // GET /api/omnichannel/campaigns/stats
  app.get('/stats', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });
    const data = await getCampaignStats(schemaName);
    return reply.send({ success: true, data });
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
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: manageCampaignsGuard }, async (request, reply) => {
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

  // GET /api/omnichannel/campaigns/:id/export/csv
  app.get<{ Params: { id: string } }>('/:id/export/csv', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const csv = await exportCampaignCsv(request.params.id, schemaName);
      const date = new Date().toISOString().slice(0, 10);
      const filename = `campanha-${request.params.id.slice(0, 8)}-${date}.csv`;
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send('﻿' + csv);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/omnichannel/campaigns/:id/export/pdf
  app.get<{ Params: { id: string } }>('/:id/export/pdf', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    const tenantId   = request.user.tenantId;
    if (!schemaName || !tenantId) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const buffer = await exportCampaignPdf(request.params.id, schemaName, tenantId);
      const date   = new Date().toISOString().slice(0, 10);
      const filename = `campanha-${request.params.id.slice(0, 8)}-${date}.pdf`;
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    } catch (err) {
      if (err instanceof Error && err.message === 'Campaign not found') {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

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

  // POST /api/omnichannel/campaigns/:id/duplicate-failed
  app.post<{ Params: { id: string }; Body: unknown }>('/:id/duplicate-failed', { preHandler: replyGuard }, async (request, reply) => {
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema não resolvido' } });

    try {
      const body = duplicateFailedCampaignBodySchema.parse(request.body);
      const campaign = await duplicateFailedCampaign(request.params.id, body, request.user.id, schemaName);
      return reply.code(201).send({ success: true, data: campaign });
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: { message: 'Dados inválidos' } });
      }
      if (err instanceof NotFoundError) return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ValidationError) return reply.code(err.statusCode).send({ success: false, error: { message: err.message } });
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
