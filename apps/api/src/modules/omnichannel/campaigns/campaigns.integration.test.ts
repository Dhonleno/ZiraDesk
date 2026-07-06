import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/database.js';
import { createTestApp, createTestJWT } from '../../../test/setup.js';
import { ensureTemplatesInfrastructure } from '../../admin/templates/templates.service.js';
import { provisionTenantSchema } from '../../super-admin/tenants/tenants.service.js';
import { closeFailedInitialOutbound } from '../outbound-failure.service.js';
import { ensureCampaignsInfrastructure } from './campaigns.infrastructure.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

const AGENT_ID = '00000000-0000-0000-0000-000000000312';
const ADMIN_ID = '00000000-0000-0000-0000-000000000313';
const VIEWER_ID = '00000000-0000-0000-0000-000000000314';

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

async function createTempTenant(): Promise<TempTenant> {
  const suffix = uniqueSuffix();
  const slug = `campaigns-${suffix.replace(/_/g, '-')}`;
  const schemaName = `campaigns_${suffix}`.toLowerCase();
  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: { name: 'Plano Teste', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true } },
    create: { name: 'Plano Teste', slug: 'test-plan', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true } },
  });
  const tenant = await prisma.tenant.create({
    data: { name: `Tenant Campaigns ${suffix}`, slug, schemaName, planId: plan.id, status: 'active', trialEndsAt: null, settings: {} },
    select: { id: true, schemaName: true },
  });
  await provisionTenantSchema(tenant.schemaName);
  await ensureTemplatesInfrastructure(tenant.schemaName);
  await ensureCampaignsInfrastructure(tenant.schemaName);

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tenant.schemaName}".users (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, 'Agent Campaigns', 'agent.campaigns@ziradesk.test', 'hash', 'agent', 'active', 'pt-BR', '{}')`,
    AGENT_ID,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tenant.schemaName}".users (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, 'Admin Campaigns', 'admin.campaigns@ziradesk.test', 'hash', 'admin', 'active', 'pt-BR', '{}')
     ON CONFLICT DO NOTHING`,
    ADMIN_ID,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tenant.schemaName}".users (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, 'Viewer Campaigns', 'viewer.campaigns@ziradesk.test', 'hash', 'viewer', 'active', 'pt-BR', '{}')
     ON CONFLICT DO NOTHING`,
    VIEWER_ID,
  );
  return tenant;
}

function agentHeader(tenant: TempTenant): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: AGENT_ID,
      email: 'agent.campaigns@ziradesk.test',
      name: 'Agent Campaigns',
      role: 'agent',
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

function adminHeader(tenant: TempTenant): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: ADMIN_ID,
      email: 'admin.campaigns@ziradesk.test',
      name: 'Admin Campaigns',
      role: 'admin',
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

function viewerHeader(tenant: TempTenant): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: VIEWER_ID,
      email: 'viewer.campaigns@ziradesk.test',
      name: 'Viewer Campaigns',
      role: 'viewer',
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
    })}`,
  };
}

async function createChannel(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".channels (id, name, type, status, credentials)
     VALUES (gen_random_uuid(), 'Canal WhatsApp', 'whatsapp', 'active', '{"phoneNumberId":"test-phone","accessToken":"test-token"}'::jsonb)
     RETURNING id`,
  );
  return rows[0]!.id;
}

async function createTemplate(
  schemaName: string,
  channelId: string,
  status = 'approved',
  metaTemplateId: string | null = 'meta-camp-id',
): Promise<string> {
  const name = `camp_tmpl_${uniqueSuffix()}`;
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".whatsapp_templates
       (channel_id, name, display_name, language, category, body, variables, status, meta_template_id)
     VALUES ($1::uuid, $3, 'Campaign Template', 'pt_BR', 'UTILITY', 'Olá {{1}}, promoção especial!', '["1"]'::jsonb, $2, $4)
     RETURNING id`,
    channelId,
    status,
    name,
    metaTemplateId,
  );
  return rows[0]!.id;
}

async function createMediaHeaderTemplate(schemaName: string, channelId: string): Promise<string> {
  const name = `camp_media_tmpl_${uniqueSuffix()}`;
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".whatsapp_templates
       (channel_id, name, display_name, language, category, body, variables, status, meta_template_id, header_type)
     VALUES ($1::uuid, $2, 'Campaign Media Template', 'pt_BR', 'MARKETING', 'Oferta especial!', '[]'::jsonb, 'approved', 'meta-media-id', 'IMAGE')
     RETURNING id`,
    channelId,
    name,
  );
  return rows[0]!.id;
}

async function createContact(schemaName: string, withPhone = true): Promise<string> {
  const phone = withPhone ? '5511999990000' : null;
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".contacts (id, name, email, phone, whatsapp)
     VALUES (gen_random_uuid(), 'Contato Campanha', 'camp@test.com', $1, $1)
     RETURNING id`,
    phone,
  );
  return rows[0]!.id;
}

describe('Campanhas integration', () => {
  let tenant: TempTenant;
  let channelId: string;
  let templateId: string;

  beforeAll(async () => {
    tenant = await createTempTenant();
    channelId = await createChannel(tenant.schemaName);
    templateId = await createTemplate(tenant.schemaName, channelId);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
  });

  // ─── CREATE ────────────────────────────────────────────────────────────────

  it('POST /campaigns → cria em draft', async () => {
    const res = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Teste', channel_id: channelId, template_id: templateId });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.name).toBe('Campanha Teste');
  });

  it('POST /campaigns com template não aprovado → 422', async () => {
    const rejectedTemplateId = await createTemplate(tenant.schemaName, channelId, 'rejected');

    const res = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Rejeitada', channel_id: channelId, template_id: rejectedTemplateId });

    expect(res.status).toBe(422);
  });

  it('POST /campaigns com template sem vínculo com a Meta → 422', async () => {
    const localTemplateId = await createTemplate(tenant.schemaName, channelId, 'approved', null);

    const res = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha local', channel_id: channelId, template_id: localTemplateId });

    expect(res.status).toBe(422);
  });

  it('POST /campaigns com hello_world → 422', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".whatsapp_templates
         (channel_id, name, display_name, language, category, body, variables, status, meta_template_id)
       VALUES ($1::uuid, 'hello_world', 'Hello World', 'en_US', 'UTILITY', 'Hello World', '[]'::jsonb, 'approved', 'meta-hello-world')
       RETURNING id`,
      channelId,
    );

    const res = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Hello World', channel_id: channelId, template_id: rows[0]!.id });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('números públicos de teste');
  });

  it('POST /campaigns com canal não-whatsapp → 422', async () => {
    const emailChannelRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".channels (name, type, status, credentials)
       VALUES ('Canal Email', 'email', 'active', '{}'::jsonb)
       RETURNING id`,
    );
    const emailChannelId = emailChannelRows[0]!.id;

    const res = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Email', channel_id: emailChannelId, template_id: templateId });

    expect(res.status).toBe(422);
  });

  it('POST /campaigns com header IMAGE exige URL da mídia e persiste quando informada', async () => {
    const mediaTemplateId = await createMediaHeaderTemplate(tenant.schemaName, channelId);

    const missingUrlRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Media Sem URL', channel_id: channelId, template_id: mediaTemplateId });

    expect(missingUrlRes.status).toBe(422);

    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({
        name: 'Campanha Media',
        channel_id: channelId,
        template_id: mediaTemplateId,
        template_header_media_url: 'https://cdn.example.com/header.jpg',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.template_header_media_url).toBe('https://cdn.example.com/header.jpg');
  });

  // ─── CONTACTS ──────────────────────────────────────────────────────────────

  it('POST /campaigns/:id/contacts → adiciona contatos', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Contatos', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const contactId = await createContact(tenant.schemaName);

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });

    expect(res.status).toBe(201);
    expect(res.body.data.added).toBe(1);
    expect(res.body.data.total_contacts).toBe(1);
  });

  it('POST /campaigns/:id/contacts com contato sem telefone → 422', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Sem Tel', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const noPhoneContactId = await createContact(tenant.schemaName, false);

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [noPhoneContactId] });

    expect(res.status).toBe(422);
  });

  it('POST /campaigns/:id/contacts adiciona por filtro e respeita exclusões', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha por filtro', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const matchingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".contacts (name, email, phone, whatsapp)
       VALUES
         ('Filtro Campanha A', 'filtro-a@test.com', '5511999991001', '5511999991001'),
         ('Filtro Campanha B', 'filtro-b@test.com', '5511999991002', '5511999991002')
       RETURNING id`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${tenant.schemaName}".contacts (name, email)
       VALUES ('Filtro Campanha sem telefone', 'filtro-sem-telefone@test.com')`,
    );

    const excludedId = matchingRows[1]!.id;
    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({
        filter: { search: 'Filtro Campanha' },
        exclude_ids: [excludedId],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.added).toBe(1);
    expect(res.body.data.total_contacts).toBe(1);

    const rows = await prisma.$queryRawUnsafe<Array<{ contact_id: string }>>(
      `SELECT contact_id::text
       FROM "${tenant.schemaName}".campaign_contacts
       WHERE campaign_id = $1::uuid`,
      campaignId,
    );
    expect(rows.map((row) => row.contact_id)).toEqual([matchingRows[0]!.id]);
  });

  it('GET /campaigns/:id/contacts → lista com status', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha List Contatos', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const contactId = await createContact(tenant.schemaName);
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });

    const res = await createTestApp()
      .get(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('pending');
    expect(res.body.data[0].contact_name).toBeTruthy();
  });

  // ─── LAUNCH ────────────────────────────────────────────────────────────────

  it('POST /campaigns/:id/launch → muda para running', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Launch', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const contactId = await createContact(tenant.schemaName);
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/launch`)
      .set(agentHeader(tenant));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('running');
  });

  it('POST /campaigns/:id/launch com scheduled_at futuro → muda para scheduled', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Agendada', channel_id: channelId, template_id: templateId, scheduled_at: futureDate });
    const campaignId = createRes.body.data.id as string;

    const contactId = await createContact(tenant.schemaName);
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/launch`)
      .set(agentHeader(tenant));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('scheduled');
  });

  it('POST /campaigns/:id/launch sem contatos → 422', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Sem Contatos', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/launch`)
      .set(agentHeader(tenant));

    expect(res.status).toBe(422);
  });

  // ─── PAUSE / RESUME ────────────────────────────────────────────────────────

  it('POST /campaigns/:id/pause → muda para paused', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Pause', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const contactId = await createContact(tenant.schemaName);
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/launch`)
      .set(agentHeader(tenant));

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/pause`)
      .set(agentHeader(tenant));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paused');
  });

  it('POST /campaigns/:id/resume → muda para running', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Resume', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const contactId = await createContact(tenant.schemaName);
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/launch`)
      .set(agentHeader(tenant));
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/pause`)
      .set(agentHeader(tenant));

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/resume`)
      .set(agentHeader(tenant));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('running');
  });

  // ─── CANCEL ────────────────────────────────────────────────────────────────

  it('POST /campaigns/:id/cancel → muda para cancelled', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Cancel', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/cancel`)
      .set(adminHeader(tenant));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  // ─── DUPLICATE ─────────────────────────────────────────────────────────────

  it('POST /campaigns/:id/duplicate → cria cópia em draft', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Original', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const contactId = await createContact(tenant.schemaName);
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/duplicate`)
      .set(agentHeader(tenant));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.name).toBe('Campanha Original (cópia)');
    expect(res.body.data.total_contacts).toBe(1);
  });

  it('POST /campaigns/:id/duplicate-failed → copia somente contatos com falha', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha com Falhas', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;
    const failedContactId = await createContact(tenant.schemaName);
    const sentContactId = await createContact(tenant.schemaName);

    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [failedContactId, sentContactId] });
    await prisma.$executeRawUnsafe(
      `UPDATE "${tenant.schemaName}".campaign_contacts
       SET status = CASE WHEN contact_id = $2::uuid THEN 'failed' ELSE 'sent' END
       WHERE campaign_id = $1::uuid`,
      campaignId,
      failedContactId,
    );

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/duplicate-failed`)
      .set(agentHeader(tenant))
      .send({
        name: 'Campanha com Falhas - novo template',
        template_id: templateId,
        template_variables: {},
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.name).toBe('Campanha com Falhas - novo template');
    expect(res.body.data.total_contacts).toBe(1);

    const copiedRows = await prisma.$queryRawUnsafe<Array<{ contact_id: string }>>(
      `SELECT contact_id::text
       FROM "${tenant.schemaName}".campaign_contacts
       WHERE campaign_id = $1::uuid`,
      res.body.data.id,
    );
    expect(copiedRows).toEqual([{ contact_id: failedContactId }]);
  });

  it('fecha automaticamente envio inicial que falhou sem resposta do contato', async () => {
    const contactId = await createContact(tenant.schemaName);
    const conversationRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".conversations
         (contact_id, channel_id, channel_type, conversation_type, status)
       VALUES ($1::uuid, $2::uuid, 'whatsapp', 'outbound', 'waiting')
       RETURNING id::text`,
      contactId,
      channelId,
    );
    const conversationId = conversationRows[0]!.id;
    const messageRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".messages
         (conversation_id, sender_type, content, content_type, status)
       VALUES ($1::uuid, 'agent', 'template', 'template', 'failed')
       RETURNING id::text`,
      conversationId,
    );

    const closed = await closeFailedInitialOutbound({
      schemaName: tenant.schemaName,
      conversationId,
      messageId: messageRows[0]!.id,
      provider: 'whatsapp',
      reason: 'Template indisponível para o destinatário',
    });

    expect(closed).toBe(true);
    const rows = await prisma.$queryRawUnsafe<Array<{ status: string; closure_reason: { reason?: string } }>>(
      `SELECT status, closure_reason
       FROM "${tenant.schemaName}".conversations
       WHERE id = $1::uuid`,
      conversationId,
    );
    expect(rows[0]?.status).toBe('closed');
    expect(rows[0]?.closure_reason.reason).toBe('outbound_delivery_failed');
  });

  // ─── REPORT ────────────────────────────────────────────────────────────────

  it('GET /campaigns/:id/report → retorna totais corretos', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Report', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    // Simulate sent contacts
    const contactId = await createContact(tenant.schemaName);
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });

    await prisma.$executeRawUnsafe(
      `UPDATE "${tenant.schemaName}".campaign_contacts
       SET status = 'delivered', sent_at = NOW(), delivered_at = NOW()
       WHERE campaign_id = $1::uuid`,
      campaignId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "${tenant.schemaName}".campaigns
       SET sent_count = 1, delivered_count = 1
       WHERE id = $1::uuid`,
      campaignId,
    );

    const res = await createTestApp()
      .get(`/api/omnichannel/campaigns/${campaignId}/report`)
      .set(agentHeader(tenant));

    expect(res.status).toBe(200);
    expect(res.body.data.campaign.sent_count).toBe(1);
    expect(res.body.data.campaign.delivered_count).toBe(1);
    expect(Array.isArray(res.body.data.breakdown)).toBe(true);
  });

  // ─── OPT-OUT ───────────────────────────────────────────────────────────────

  it('Opt-out: serviço handleCampaignOptOut marca opted_out', async () => {
    const { handleCampaignOptOut } = await import('./campaigns.service.js');

    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Optout', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const contactId = await createContact(tenant.schemaName);
    await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/contacts`)
      .set(agentHeader(tenant))
      .send({ contact_ids: [contactId] });

    // Set a fake conversation for context
    const convRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".conversations
         (contact_id, channel_id, channel_type, conversation_type, status, metadata)
       VALUES ($1::uuid, $2::uuid, 'whatsapp', 'outbound', 'waiting', $3::jsonb)
       RETURNING id`,
      contactId,
      channelId,
      JSON.stringify({ campaign_id: campaignId }),
    );
    const conversationId = convRows[0]!.id;

    await handleCampaignOptOut(tenant.schemaName, conversationId, contactId, campaignId, '5511999990000');

    const ccRows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT status FROM "${tenant.schemaName}".campaign_contacts
       WHERE campaign_id = $1::uuid AND contact_id = $2::uuid LIMIT 1`,
      campaignId,
      contactId,
    );
    expect(ccRows[0]?.status).toBe('opted_out');

    const optoutRows = await prisma.$queryRawUnsafe<Array<{ contact_id: string }>>(
      `SELECT contact_id::text FROM "${tenant.schemaName}".campaign_optouts WHERE contact_id = $1::uuid LIMIT 1`,
      contactId,
    );
    expect(optoutRows[0]?.contact_id).toBe(contactId);
  });

  // ─── PERMISSÕES ────────────────────────────────────────────────────────────

  it('Permissão: agent pode criar campanha', async () => {
    const res = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Agent', channel_id: channelId, template_id: templateId });
    expect(res.status).toBe(201);
  });

  it('Permissão: viewer não pode criar campanha (403)', async () => {
    const res = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(viewerHeader(tenant))
      .send({ name: 'Campanha Viewer', channel_id: channelId, template_id: templateId });
    expect(res.status).toBe(403);
  });

  it('Permissão: viewer não pode cancelar campanha (403)', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Cancel Perm', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/cancel`)
      .set(viewerHeader(tenant));

    expect(res.status).toBe(403);
  });

  it('Permissão: admin pode cancelar campanha', async () => {
    const createRes = await createTestApp()
      .post('/api/omnichannel/campaigns')
      .set(agentHeader(tenant))
      .send({ name: 'Campanha Admin Cancel', channel_id: channelId, template_id: templateId });
    const campaignId = createRes.body.data.id as string;

    const res = await createTestApp()
      .post(`/api/omnichannel/campaigns/${campaignId}/cancel`)
      .set(adminHeader(tenant));

    expect(res.status).toBe(200);
  });

  it('GET /campaigns/:id/report não encontrado → 404', async () => {
    const res = await createTestApp()
      .get(`/api/omnichannel/campaigns/${randomUUID()}/report`)
      .set(agentHeader(tenant));
    expect(res.status).toBe(404);
  });
});
