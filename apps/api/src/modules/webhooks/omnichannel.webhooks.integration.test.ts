import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import { Webhook } from 'svix';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { prisma } from '../../config/database.js';
import { createTestApp } from '../../test/setup.js';
import { ensureTemplatesInfrastructure } from '../admin/templates/templates.service.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

interface ChannelRef {
  schemaName: string;
  id: string;
}

const META_APP_SECRET_TEST = process.env['META_APP_SECRET'] ?? 'meta_app_secret_for_integration_tests';
const channelRefs: ChannelRef[] = [];
const tempTenants: TempTenant[] = [];

function requireGlobalTenant(): { id: string; slug: string; schemaName: string } {
  const id = globalThis.__ZIRADESK_TEST_TENANT_ID__;
  const slug = globalThis.__ZIRADESK_TEST_TENANT_SLUG__;
  const schemaName = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!id || !slug || !schemaName) {
    throw new Error('Tenant de integração não inicializado');
  }
  return { id, slug, schemaName };
}

function uniqueToken(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function createMetaSignature(rawBody: string, appSecret = META_APP_SECRET_TEST): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

function createResendHeaders(payload: unknown, secret = env.RESEND_WEBHOOK_SECRET): Record<string, string> {
  if (!secret) throw new Error('RESEND_WEBHOOK_SECRET ausente nos testes');
  const webhook = new Webhook(secret);
  const id = `msg_${randomUUID()}`;
  const timestamp = new Date();
  return {
    'svix-id': id,
    'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'svix-signature': webhook.sign(id, timestamp, JSON.stringify(payload)),
  };
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 15_000, intervalMs = 150): Promise<T> {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const value = await fn();
    if (value !== null) return value;
    await delay(intervalMs);
  }
  throw new Error(`Timeout aguardando condição assíncrona (${timeoutMs}ms)`);
}

async function ensure24x7(schemaName: string): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM "${schemaName}".business_hours_config
     ORDER BY created_at ASC
     LIMIT 1`,
  );

  if (rows[0]?.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE "${schemaName}".business_hours_config
       SET is_24x7 = true,
           updated_at = NOW()
       WHERE id = $1::uuid`,
      rows[0].id,
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".business_hours_config (is_24x7, created_at, updated_at)
     VALUES (true, NOW(), NOW())`,
  );
}

async function insertChannel(
  schemaName: string,
  type: 'whatsapp' | 'instagram',
  credentials: Record<string, unknown>,
): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".channels (type, name, credentials, status, settings)
     VALUES ($1, $2, $3::jsonb, 'active', '{}'::jsonb)
     RETURNING id`,
    type,
    `${type}-it-${uniqueToken('channel')}`,
    JSON.stringify(credentials),
  );
  const id = rows[0]!.id;
  channelRefs.push({ schemaName, id });
  return id;
}

async function createExtraTenant(status: 'active' | 'suspended' = 'active'): Promise<TempTenant> {
  const slug = uniqueToken('tenant').toLowerCase();
  const schemaName = uniqueToken('schema').toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: {
      name: 'Plano Teste',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true },
    },
    create: {
      name: 'Plano Teste',
      slug: 'test-plan',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true },
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${slug}`,
      slug,
      schemaName,
      planId: plan.id,
      status,
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, schemaName: true },
  });

  await provisionTenantSchema(schemaName);
  await ensure24x7(schemaName);

  tempTenants.push({ id: tenant.id, schemaName: tenant.schemaName });
  return { id: tenant.id, schemaName: tenant.schemaName };
}

async function countByExternalId(schemaName: string, externalId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count
     FROM "${schemaName}".messages
     WHERE external_id = $1`,
    externalId,
  );
  return Number(rows[0]?.count ?? 0n);
}

interface ConversationState {
  id: string;
  status: string;
  csat_stage: string | null;
  csat_score: number | null;
  protocol_number: string | null;
  assigned_to: string | null;
}

async function listConversationsByContact(
  schemaName: string,
  contactId: string,
): Promise<ConversationState[]> {
  return prisma.$queryRawUnsafe<ConversationState[]>(
    `SELECT id::text, status::text, csat_stage, csat_score, protocol_number, assigned_to::text
     FROM "${schemaName}".conversations
     WHERE contact_id = $1::uuid
     ORDER BY created_at ASC`,
    contactId,
  );
}

interface CsatScenario {
  phoneNumberId: string;
  waId: string;
  contactId: string;
  conversationId: string;
  protocolNumber: string;
}

/**
 * Conversa encerrada com a janela de CSAT ainda registrada — o estado em que o
 * webhook precisava decidir entre reaproveitar a conversa velha ou abrir uma nova.
 */
async function setupClosedCsatConversation(
  schemaName: string,
  options: {
    csatExpired: boolean;
    assignAgent?: boolean;
    botStage?: string | null;
    csatStage?: 'sent' | 'waiting_comment';
  },
): Promise<CsatScenario> {
  const phoneNumberId = `1555888${Math.floor(Math.random() * 100000)}`;
  const waId = `5511966${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
  const storedPhone = `+${waId}`;
  const protocolNumber = `P${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000)}`;

  const channelId = await insertChannel(schemaName, 'whatsapp', {
    phoneNumberId,
    phone_number_id: phoneNumberId,
    accessToken: 'EAAD_TEST_TOKEN',
    access_token: 'EAAD_TEST_TOKEN',
    verifyToken: 'VERIFY_TOKEN',
    wabaId: '1234567890',
  });

  const contactRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".contacts (name, phone, whatsapp)
     VALUES ('Contato CSAT', $1, $1)
     RETURNING id`,
    storedPhone,
  );
  const contactId = contactRows[0]!.id;

  let assignedTo: string | null = null;
  if (options.assignAgent) {
    const userRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM "${schemaName}".users ORDER BY created_at ASC LIMIT 1`,
    );
    assignedTo = userRows[0]?.id ?? null;
    if (!assignedTo) throw new Error('Tenant de teste sem usuário para atribuir');
  }

  const conversationRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".conversations
       (contact_id, channel_id, channel_type, conversation_type, status, protocol_number,
        assigned_to, assigned_at, closed_at, resolved_at,
        csat_stage, csat_sent_at, csat_expires_at, metadata)
     VALUES ($1::uuid, $2::uuid, 'whatsapp', 'inbound', 'closed', $3,
             $4::uuid, CASE WHEN $4::uuid IS NULL THEN NULL ELSE NOW() END, NOW(), NOW(),
             $5, NOW(), $6::timestamptz, $7::jsonb)
     RETURNING id`,
    contactId,
    channelId,
    protocolNumber,
    assignedTo,
    options.csatStage ?? 'sent',
    options.csatExpired
      ? new Date(Date.now() - 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    JSON.stringify(options.botStage ? { bot_stage: options.botStage } : {}),
  );

  return {
    phoneNumberId,
    waId,
    contactId,
    conversationId: conversationRows[0]!.id,
    protocolNumber,
  };
}

function buildTextWebhookPayload(params: {
  phoneNumberId: string;
  waId: string;
  externalId: string;
  body: string;
}): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+1 555 078 3881',
                phone_number_id: params.phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: 'Contato CSAT' },
                  wa_id: params.waId,
                },
              ],
              messages: [
                {
                  from: params.waId,
                  id: params.externalId,
                  timestamp: '1697040130',
                  text: { body: params.body },
                  type: 'text',
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function postWhatsAppWebhook(payload: Record<string, unknown>): Promise<number> {
  const rawBody = JSON.stringify(payload);
  const response = await createTestApp()
    .post('/api/webhooks/whatsapp')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', createMetaSignature(rawBody))
    .send(payload);
  return response.status;
}

async function waitForMessageConversationId(
  schemaName: string,
  externalId: string,
): Promise<string> {
  return waitFor(async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ conversation_id: string }>>(
      `SELECT conversation_id::text
       FROM "${schemaName}".messages
       WHERE external_id = $1
       LIMIT 1`,
      externalId,
    );
    return rows[0]?.conversation_id ?? null;
  });
}

describe('Omnichannel webhooks integration', () => {
  afterEach(async () => {
    while (channelRefs.length > 0) {
      const channel = channelRefs.pop()!;
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${channel.schemaName}".channels WHERE id = $1::uuid`,
        channel.id,
      ).catch(() => undefined);
    }

    while (tempTenants.length > 0) {
      const tenant = tempTenants.pop()!;
      await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
    }
  });

  it('POST /api/webhooks/whatsapp com payload válido cria mensagem no banco', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const phoneNumberId = `1555000${Math.floor(Math.random() * 100000)}`;
    const waId = `5511999${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;
    const tenantAppSecret = `tenant_app_secret_${randomUUID()}`;

    await insertChannel(schemaName, 'whatsapp', {
      phoneNumberId,
      phone_number_id: phoneNumberId,
      accessToken: 'EAAD_TEST_TOKEN',
      access_token: 'EAAD_TEST_TOKEN',
      verifyToken: 'VERIFY_TOKEN',
      verify_token: 'VERIFY_TOKEN',
      wabaId: '1234567890',
      waba_id: '1234567890',
      appSecret: tenantAppSecret,
    });

    // Payload baseado no formato oficial de webhook de mensagens da Meta WhatsApp Cloud API.
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1 555 078 3881',
                  phone_number_id: phoneNumberId,
                },
                contacts: [
                  {
                    profile: { name: 'Joao Tester' },
                    wa_id: waId,
                  },
                ],
                messages: [
                  {
                    from: waId,
                    id: externalId,
                    timestamp: '1697040123',
                    text: { body: 'Olá! Preciso de ajuda.' },
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const response = await createTestApp()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', createMetaSignature(rawBody, tenantAppSecret))
      .send(payload);

    expect(response.status).toBe(200);

    const count = await waitFor(async () => {
      const value = await countByExternalId(schemaName, externalId);
      return value > 0 ? value : null;
    });
    expect(count).toBe(1);
  });

  it('POST /api/webhooks/whatsapp com HMAC inválido retorna 401', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [],
    };

    const response = await createTestApp()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=invalid_signature')
      .send(payload);

    expect(response.status).toBe(401);
  });

  it('Webhook de contato compartilhado salva os dados como mensagem legível', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const phoneNumberId = `1555666${Math.floor(Math.random() * 100000)}`;
    const waId = `5511998${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;

    await insertChannel(schemaName, 'whatsapp', {
      phoneNumberId,
      accessToken: 'EAAD_TEST_TOKEN',
      verifyToken: 'VERIFY_TOKEN',
      wabaId: '1234567890',
    });

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1 555 078 3881',
                  phone_number_id: phoneNumberId,
                },
                contacts: [
                  {
                    profile: { name: 'Cliente Origem' },
                    wa_id: waId,
                  },
                ],
                messages: [
                  {
                    from: waId,
                    id: externalId,
                    timestamp: '1697040127',
                    type: 'contacts',
                    contacts: [
                      {
                        name: { formatted_name: 'Douglas Contato' },
                        phones: [
                          { phone: '+55 77 99999-9105', type: 'CELL', wa_id: '5577999999105' },
                        ],
                        emails: [{ email: 'douglas@example.com', type: 'WORK' }],
                        org: { company: 'Fazenda Teste', title: 'Gerente' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const response = await createTestApp()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', createMetaSignature(rawBody))
      .send(payload);

    expect(response.status).toBe(200);

    const saved = await waitFor(async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ content: string; metadata: unknown }>>(
        `SELECT content, metadata
         FROM "${schemaName}".messages
         WHERE external_id = $1
         LIMIT 1`,
        externalId,
      );
      return rows[0] ?? null;
    });

    expect(saved.content).toContain('Contato compartilhado: Douglas Contato');
    expect(saved.content).toContain('Telefone (CELL): +55 77 99999-9105');
    expect(saved.content).toContain('E-mail (WORK): douglas@example.com');
    expect(saved.content).not.toBe('📎 Anexo');
    expect(saved.metadata).toMatchObject({
      message_type: 'contacts',
      shared_contacts: [
        {
          name: 'Douglas Contato',
        },
      ],
    });
  });

  it('Webhook de status de template atualiza o status persistido pela Meta', async () => {
    const { schemaName } = requireGlobalTenant();
    const wabaId = `waba_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const channelId = await insertChannel(schemaName, 'whatsapp', {
      phoneNumberId: `1555333${Math.floor(Math.random() * 100000)}`,
      accessToken: 'EAAD_TEST_TOKEN',
      wabaId,
    });
    await ensureTemplatesInfrastructure(schemaName);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".whatsapp_templates
        (channel_id, name, display_name, language, category, body, status, meta_template_id, last_synced_at)
       VALUES ($1::uuid, 'webhook_status_test', 'Webhook status test', 'pt_BR', 'UTILITY',
               'Olá', 'pending', 'meta_webhook_001', NOW())`,
      channelId,
    );

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: wabaId,
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                event: 'APPROVED',
                message_template_id: 'meta_webhook_001',
                message_template_name: 'webhook_status_test',
                message_template_language: 'pt_BR',
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const response = await createTestApp()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', createMetaSignature(rawBody))
      .send(payload);

    expect(response.status).toBe(200);

    const status = await waitFor(async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status
         FROM "${schemaName}".whatsapp_templates
         WHERE channel_id = $1::uuid
           AND meta_template_id = 'meta_webhook_001'
         LIMIT 1`,
        channelId,
      );
      return rows[0]?.status === 'approved' ? rows[0].status : null;
    });
    expect(status).toBe('approved');
  });

  it('Webhook de mensagem de contato inexistente cria contato automaticamente', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const phoneNumberId = `1555111${Math.floor(Math.random() * 100000)}`;
    const waId = `5511888${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;
    const digits = waId.replace(/\D/g, '');

    await insertChannel(schemaName, 'whatsapp', {
      phoneNumberId,
      accessToken: 'EAAD_TEST_TOKEN',
      verifyToken: 'VERIFY_TOKEN',
      wabaId: '1234567890',
    });

    const before = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "${schemaName}".contacts
       WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1`,
      digits,
    );

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1 555 078 3881',
                  phone_number_id: phoneNumberId,
                },
                contacts: [
                  {
                    profile: { name: 'Contato Novo' },
                    wa_id: waId,
                  },
                ],
                messages: [
                  {
                    from: waId,
                    id: externalId,
                    timestamp: '1697040124',
                    text: { body: 'Primeiro contato' },
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const response = await createTestApp()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', createMetaSignature(rawBody))
      .send(payload);

    expect(response.status).toBe(200);

    await waitFor(async () => {
      const value = await countByExternalId(schemaName, externalId);
      return value > 0 ? value : null;
    });

    const after = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "${schemaName}".contacts
       WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1`,
      digits,
    );

    expect(Number(after[0]?.count ?? 0n)).toBe(Number(before[0]?.count ?? 0n) + 1);
  });

  it('Webhook com celular BR legado reutiliza contato e conversa com nono dígito', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);
    const phoneNumberId = `1555444${Math.floor(Math.random() * 100000)}`;
    const legacyPhone = `556285${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
    const normalizedPhone = `+${legacyPhone.slice(0, 4)}9${legacyPhone.slice(4)}`;
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;
    const channelId = await insertChannel(schemaName, 'whatsapp', {
      phoneNumberId,
      accessToken: 'EAAD_TEST_TOKEN',
      verifyToken: 'VERIFY_TOKEN',
      wabaId: '1234567890',
    });

    const contactRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${schemaName}".contacts (name, phone, whatsapp)
       VALUES ('Contato normalizado', $1, $1)
       RETURNING id`,
      normalizedPhone,
    );
    const contactId = contactRows[0]!.id;
    const conversationRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${schemaName}".conversations
         (contact_id, channel_id, channel_type, conversation_type, status)
       VALUES ($1::uuid, $2::uuid, 'whatsapp', 'inbound', 'open')
       RETURNING id`,
      contactId,
      channelId,
    );
    const conversationId = conversationRows[0]!.id;

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1 555 078 3881',
                  phone_number_id: phoneNumberId,
                },
                contacts: [
                  {
                    profile: { name: 'Contato normalizado' },
                    wa_id: legacyPhone,
                  },
                ],
                messages: [
                  {
                    from: legacyPhone,
                    id: externalId,
                    timestamp: '1697040126',
                    text: { body: 'Mensagem pelo número legado' },
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const response = await createTestApp()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', createMetaSignature(rawBody))
      .send(payload);

    expect(response.status).toBe(200);

    const persistedConversationId = await waitFor(async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ conversation_id: string }>>(
        `SELECT conversation_id::text
         FROM "${schemaName}".messages
         WHERE external_id = $1
         LIMIT 1`,
        externalId,
      );
      return rows[0]?.conversation_id ?? null;
    });
    expect(persistedConversationId).toBe(conversationId);

    const contactCountRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "${schemaName}".contacts
       WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') IN ($1, $2)
          OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') IN ($1, $2)`,
      legacyPhone,
      normalizedPhone.replace(/\D/g, ''),
    );
    expect(Number(contactCountRows[0]?.count ?? 0n)).toBe(1);
  }, 30_000);

  it('Webhook duplicado (mesmo external_id) não duplica mensagem', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const phoneNumberId = `1555222${Math.floor(Math.random() * 100000)}`;
    const waId = `5511777${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;

    await insertChannel(schemaName, 'whatsapp', {
      phoneNumberId,
      accessToken: 'EAAD_TEST_TOKEN',
      verifyToken: 'VERIFY_TOKEN',
      wabaId: '1234567890',
    });

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1 555 078 3881',
                  phone_number_id: phoneNumberId,
                },
                contacts: [
                  {
                    profile: { name: 'Contato Dup' },
                    wa_id: waId,
                  },
                ],
                messages: [
                  {
                    from: waId,
                    id: externalId,
                    timestamp: '1697040125',
                    text: { body: 'Mensagem única' },
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const signature = createMetaSignature(rawBody);

    const first = await createTestApp()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(payload);
    expect(first.status).toBe(200);

    await waitFor(async () => {
      const value = await countByExternalId(schemaName, externalId);
      return value > 0 ? value : null;
    });

    const second = await createTestApp()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(payload);
    expect(second.status).toBe(200);

    await delay(300);
    const count = await countByExternalId(schemaName, externalId);
    expect(count).toBe(1);
  });

  it('CSAT expirado com agente atribuído abre conversa nova e mantém a velha encerrada', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const scenario = await setupClosedCsatConversation(schemaName, {
      csatExpired: true,
      assignAgent: true,
    });
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;

    expect(await postWhatsAppWebhook(buildTextWebhookPayload({
      phoneNumberId: scenario.phoneNumberId,
      waId: scenario.waId,
      externalId,
      body: 'Oi, voltei com outra dúvida',
    }))).toBe(200);

    const messageConversationId = await waitForMessageConversationId(schemaName, externalId);
    const conversations = await listConversationsByContact(schemaName, scenario.contactId);
    expect(conversations).toHaveLength(2);

    const [oldConversation, newConversation] = conversations as [ConversationState, ConversationState];
    expect(oldConversation.id).toBe(scenario.conversationId);
    expect(oldConversation.status).toBe('closed');
    expect(oldConversation.csat_stage).toBe('done');

    expect(newConversation.status).toBe('open');
    expect(newConversation.protocol_number).toBeTruthy();
    expect(newConversation.protocol_number).not.toBe(scenario.protocolNumber);
    expect(messageConversationId).toBe(newConversation.id);
  }, 30_000);

  it('CSAT expirado sem agente e sem bot_stage abre conversa nova sem reabrir a velha', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const scenario = await setupClosedCsatConversation(schemaName, {
      csatExpired: true,
      assignAgent: false,
      botStage: null,
    });
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;

    expect(await postWhatsAppWebhook(buildTextWebhookPayload({
      phoneNumberId: scenario.phoneNumberId,
      waId: scenario.waId,
      externalId,
      body: 'Preciso de ajuda de novo',
    }))).toBe(200);

    const messageConversationId = await waitForMessageConversationId(schemaName, externalId);
    const conversations = await listConversationsByContact(schemaName, scenario.contactId);
    expect(conversations).toHaveLength(2);

    const [oldConversation, newConversation] = conversations as [ConversationState, ConversationState];
    expect(oldConversation.id).toBe(scenario.conversationId);
    // O bug corrigido reabria esta conversa em vez de criar uma nova.
    expect(oldConversation.status).toBe('closed');
    expect(oldConversation.csat_stage).toBe('done');

    expect(newConversation.status).toBe('open');
    expect(newConversation.protocol_number).not.toBe(scenario.protocolNumber);
    expect(messageConversationId).toBe(newConversation.id);
  }, 30_000);

  it('CSAT expirado com bot_stage=done abre conversa nova (mensagem não some)', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const scenario = await setupClosedCsatConversation(schemaName, {
      csatExpired: true,
      assignAgent: false,
      botStage: 'done',
    });
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;

    expect(await postWhatsAppWebhook(buildTextWebhookPayload({
      phoneNumberId: scenario.phoneNumberId,
      waId: scenario.waId,
      externalId,
      body: 'Bom dia, tenho outra questão',
    }))).toBe(200);

    const messageConversationId = await waitForMessageConversationId(schemaName, externalId);
    const conversations = await listConversationsByContact(schemaName, scenario.contactId);
    expect(conversations).toHaveLength(2);

    const [oldConversation, newConversation] = conversations as [ConversationState, ConversationState];
    expect(oldConversation.id).toBe(scenario.conversationId);
    expect(oldConversation.status).toBe('closed');
    expect(oldConversation.csat_stage).toBe('done');

    expect(newConversation.status).toBe('open');
    expect(newConversation.protocol_number).not.toBe(scenario.protocolNumber);
    // Antes da correção a mensagem era gravada na conversa fechada e não aparecia
    // em nenhuma fila nem para nenhum agente.
    expect(messageConversationId).toBe(newConversation.id);
  }, 30_000);

  it('CSAT dentro do prazo continua na conversa velha e não cria conversa nova', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const scenario = await setupClosedCsatConversation(schemaName, {
      csatExpired: false,
      assignAgent: false,
    });
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;

    expect(await postWhatsAppWebhook(buildTextWebhookPayload({
      phoneNumberId: scenario.phoneNumberId,
      waId: scenario.waId,
      externalId,
      body: '5',
    }))).toBe(200);

    const messageConversationId = await waitForMessageConversationId(schemaName, externalId);
    expect(messageConversationId).toBe(scenario.conversationId);

    const conversations = await listConversationsByContact(schemaName, scenario.contactId);
    expect(conversations).toHaveLength(1);
    // Janela ainda aberta: a finalização de CSAT expirado NÃO pode ter rodado.
    expect(conversations[0]!.csat_stage).toBe('sent');
    expect(conversations[0]!.protocol_number).toBe(scenario.protocolNumber);
  }, 30_000);

  it('Palavra-chave de encerramento na janela de CSAT expirado encerra a velha sem criar nova', async () => {
    const { schemaName } = requireGlobalTenant();
    await ensure24x7(schemaName);

    const scenario = await setupClosedCsatConversation(schemaName, {
      csatExpired: true,
      assignAgent: false,
    });
    const externalId = `wamid.${randomUUID().replace(/-/g, '')}`;

    expect(await postWhatsAppWebhook(buildTextWebhookPayload({
      phoneNumberId: scenario.phoneNumberId,
      waId: scenario.waId,
      externalId,
      body: '#sair',
    }))).toBe(200);

    await waitFor(async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text
         FROM "${schemaName}".messages
         WHERE conversation_id = $1::uuid
           AND sender_type = 'system'
         LIMIT 1`,
        scenario.conversationId,
      );
      return rows[0]?.id ?? null;
    });

    const conversations = await listConversationsByContact(schemaName, scenario.contactId);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.id).toBe(scenario.conversationId);
    expect(conversations[0]!.status).toBe('closed');
  }, 30_000);

  it('POST /api/webhooks/instagram com payload válido cria mensagem', async () => {
    const { schemaName } = requireGlobalTenant();
    const pageId = `178414${Math.floor(Math.random() * 1_000_000_000_000)}`;
    const senderId = `17841${Math.floor(Math.random() * 1_000_000_000_000)}`;
    const mid = `ig_mid_${randomUUID()}`;

    await insertChannel(schemaName, 'instagram', {
      page_id: pageId,
      access_token: 'IG_ACCESS_TOKEN_TEST',
    });

    // Payload baseado no formato oficial de webhook de DM do Instagram Graph/Messenger API.
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: pageId,
          time: 1715251200,
          messaging: [
            {
              sender: { id: senderId },
              recipient: { id: pageId },
              timestamp: 1715251200123,
              message: {
                mid,
                text: 'Oi, mensagem via Instagram',
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const response = await createTestApp()
      .post('/api/webhooks/instagram')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', createMetaSignature(rawBody))
      .send(payload);

    expect(response.status).toBe(200);

    const messageCount = await waitFor(async () => {
      const count = await countByExternalId(schemaName, mid);
      return count > 0 ? count : null;
    });
    expect(messageCount).toBe(1);
  });

  it('POST /api/webhooks/instagram com token inválido retorna 403', async () => {
    const response = await createTestApp()
      .get('/api/webhooks/instagram')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token-invalido',
        'hub.challenge': 'challenge-value',
      });

    expect(response.status).toBe(403);
  });

  it('POST /api/webhooks/email com payload Resend válido cria ticket de inbound', async () => {
    const { slug, schemaName } = requireGlobalTenant();
    const messageId = `<example+${randomUUID()}@resend.dev>`;
    const from = `customer+${Math.floor(Math.random() * 1_000_000)}@example.com`;

    // Payload baseado no evento oficial "email.received" da documentação do Resend.
    const payload = {
      type: 'email.received',
      created_at: '2026-02-22T23:41:12.126Z',
      data: {
        email_id: randomUUID(),
        created_at: '2026-02-22T23:41:11.894719+00:00',
        from,
        to: [`suporte@${slug}.ziradesk.com`],
        bcc: [],
        cc: [],
        message_id: messageId,
        subject: 'Sending this example',
        text: 'Olá, preciso de suporte no meu acesso.',
        html: '<p>Olá, preciso de suporte no meu acesso.</p>',
      },
    };

    const response = await createTestApp()
      .post('/api/webhooks/email')
      .set('Content-Type', 'application/json')
      .set(createResendHeaders(payload))
      .send(payload);

    expect(response.status).toBe(200);

    const ticket = await waitFor(async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; source: string }>>(
        `SELECT id, source
         FROM "${schemaName}".tickets
         WHERE email_message_id = $1
         LIMIT 1`,
        messageId,
      );
      return rows[0] ?? null;
    });

    expect(ticket.source).toBe('email');
  });

  it('POST /api/webhooks/email sem segredo válido não cria ticket', async () => {
    const { slug, schemaName } = requireGlobalTenant();
    const messageId = `<unauthorized-${randomUUID()}@resend.dev>`;

    const invalidPayload = {
      type: 'email.received',
      data: {
        from: `intruso-${randomUUID()}@example.com`,
        to: [`suporte@${slug}.ziradesk.com`],
        message_id: messageId,
        subject: 'Tentativa sem segredo',
        text: 'corpo',
      },
    };

    const response = await createTestApp()
      .post('/api/webhooks/email')
      .set('Content-Type', 'application/json')
      .set(createResendHeaders(invalidPayload, 'whsec_c2VncmVkb19lcnJhZG8='))
      .send(invalidPayload);

    expect(response.status).toBe(401);
    await delay(400);

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "${schemaName}".tickets WHERE email_message_id = $1 LIMIT 1`,
      messageId,
    );
    expect(rows).toHaveLength(0);
  });

  it('POST /api/webhooks/email com inbound_email_department_id passa por createTicket', async () => {
    const { id: tenantId, slug, schemaName } = requireGlobalTenant();
    const messageId = `<routed-${randomUUID()}@resend.dev>`;

    const departmentRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${schemaName}".departments (name) VALUES ($1) RETURNING id`,
      `Inbound ${randomUUID().slice(0, 8)}`,
    );
    const departmentId = departmentRows[0]?.id;
    if (!departmentId) throw new Error('Falha ao criar departamento de inbound');

    const tenantBefore = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: { inbound_email_department_id: departmentId } },
    });

    try {
      const payload = {
        type: 'email.received',
        data: {
          from: `roteado-${randomUUID()}@example.com`,
          to: [`suporte@${slug}.ziradesk.com`],
          message_id: messageId,
          subject: 'Ticket roteado por departamento',
          text: 'Preciso de ajuda.',
        },
      };

      const response = await createTestApp()
        .post('/api/webhooks/email')
        .set('Content-Type', 'application/json')
        .set(createResendHeaders(payload))
        .send(payload);

      expect(response.status).toBe(200);

      const ticket = await waitFor(async () => {
        const rows = await prisma.$queryRawUnsafe<Array<{
          id: string; source: string; department_id: string | null;
        }>>(
          `SELECT id, source, department_id
           FROM "${schemaName}".tickets
           WHERE email_message_id = $1
           LIMIT 1`,
          messageId,
        );
        return rows[0] ?? null;
      });

      // createTicket hardcodava source='manual'; o parâmetro interno preserva 'email'.
      expect(ticket.source).toBe('email');
      expect(ticket.department_id).toBe(departmentId);
    } finally {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { settings: (tenantBefore?.settings ?? {}) as Prisma.InputJsonValue },
      });
    }
  });

  it('Email de remetente sem contato vinculado cria contato automaticamente', async () => {
    const { slug, schemaName } = requireGlobalTenant();
    const senderEmail = `novo-contato-${Date.now()}@example.com`;
    const messageId = `<new-contact-${randomUUID()}@resend.dev>`;

    const before = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "${schemaName}".contacts
       WHERE LOWER(email) = LOWER($1)`,
      senderEmail,
    );

    const payload = {
      type: 'email.received',
      created_at: '2026-02-22T23:41:12.126Z',
      data: {
        email_id: randomUUID(),
        created_at: '2026-02-22T23:41:11.894719+00:00',
        from: `Cliente Novo <${senderEmail}>`,
        to: [`suporte@${slug}.ziradesk.com`],
        message_id: messageId,
        subject: 'Primeiro contato',
        text: 'Ainda não sou cadastrado.',
        html: '<p>Ainda não sou cadastrado.</p>',
      },
    };

    const response = await createTestApp()
      .post('/api/webhooks/email')
      .set('Content-Type', 'application/json')
      .set(createResendHeaders(payload))
      .send(payload);

    expect(response.status).toBe(200);

    await waitFor(async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id
         FROM "${schemaName}".tickets
         WHERE email_message_id = $1
         LIMIT 1`,
        messageId,
      );
      return rows[0] ?? null;
    });

    const after = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "${schemaName}".contacts
       WHERE LOWER(email) = LOWER($1)`,
      senderEmail,
    );

    expect(Number(after[0]?.count ?? 0n)).toBe(Number(before[0]?.count ?? 0n) + 1);
  });

  it('Webhook com page_id do tenant A não cria dados no tenant B', async () => {
    const tenantA = requireGlobalTenant();
    const tenantB = await createExtraTenant('active');

    const pageIdA = `178414A${Math.floor(Math.random() * 1_000_000_000)}`;
    const pageIdB = `178414B${Math.floor(Math.random() * 1_000_000_000)}`;
    const mid = `ig_mid_${randomUUID()}`;

    await insertChannel(tenantA.schemaName, 'instagram', {
      page_id: pageIdA,
      access_token: 'IG_ACCESS_TOKEN_A',
    });
    await insertChannel(tenantB.schemaName, 'instagram', {
      page_id: pageIdB,
      access_token: 'IG_ACCESS_TOKEN_B',
    });

    const payload = {
      object: 'instagram',
      entry: [
        {
          id: pageIdA,
          time: 1715251200,
          messaging: [
            {
              sender: { id: `17841${Math.floor(Math.random() * 1_000_000_000_000)}` },
              recipient: { id: pageIdA },
              timestamp: 1715251200456,
              message: {
                mid,
                text: 'Mensagem para tenant A',
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const response = await createTestApp()
      .post('/api/webhooks/instagram')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', createMetaSignature(rawBody))
      .send(payload);

    expect(response.status).toBe(200);

    const countA = await waitFor(async () => {
      const value = await countByExternalId(tenantA.schemaName, mid);
      return value > 0 ? value : null;
    });
    expect(countA).toBe(1);

    await delay(250);
    const countB = await countByExternalId(tenantB.schemaName, mid);
    expect(countB).toBe(0);
  });
});
