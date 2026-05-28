import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { ensureTemplatesInfrastructure } from '../admin/templates/templates.service.js';

const TEST_AUTH_SUB = '00000000-0000-0000-0000-000000000091';

function requireSchema(): string {
  const s = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!s) throw new Error('Schema de teste não inicializado');
  return s;
}

function authHeader(lang?: string) {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_AUTH_SUB,
      email: 'ao.integration@ziradesk.test',
      name: 'Active Outbound Integration User',
      role: 'owner',
    })}`,
    ...(lang ? { 'Accept-Language': lang } : {}),
  };
}

describe('POST /api/omnichannel/active-outbound — validação de template', () => {
  let channelId: string;
  let contactId: string;
  let templateBodyVarName: string;

  beforeAll(async () => {
    const schema = requireSchema();
    await ensureTemplatesInfrastructure(schema);

    const [channel] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${schema}".channels (type, name, credentials, status)
       VALUES ('whatsapp', 'WA AO Integration Test', $1::jsonb, 'active')
       RETURNING id`,
      JSON.stringify({ phoneNumberId: 'test_phone_id', accessToken: 'test_access_token' }),
    );
    channelId = channel!.id;

    const [contact] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${schema}".contacts (name, phone, whatsapp)
       VALUES ('Test Contact AO', '+5511900000091', '+5511900000091')
       RETURNING id`,
    );
    contactId = contact!.id;

    // Template 1: IMAGE header (requires media)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".whatsapp_templates
        (channel_id, name, display_name, language, category, body, header_format,
         variables, buttons_json, status, meta_template_id, last_synced_at)
       VALUES ($1::uuid, 'ao_test_image', 'AO Test Image', 'pt_BR', 'UTILITY',
               'Sua nota fiscal está disponível.', 'IMAGE',
               '[]'::jsonb, '[]'::jsonb, 'approved', 'meta_ao_image_001', NOW())`,
      channelId,
    );

    // Template 2: body with 1 variable
    templateBodyVarName = 'ao_test_body_var';
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".whatsapp_templates
        (channel_id, name, display_name, language, category, body,
         variables, buttons_json, status, meta_template_id, last_synced_at)
       VALUES ($1::uuid, $2, 'AO Test Body Var', 'pt_BR', 'UTILITY',
               'Olá {{1}}, seu chamado foi aberto.',
               '[{"index":"1","example":""}]'::jsonb, '[]'::jsonb, 'approved', 'meta_ao_body_001', NOW())`,
      channelId,
      templateBodyVarName,
    );
  });

  afterAll(async () => {
    const schema = requireSchema();
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${schema}".channels WHERE id = $1::uuid`,
      channelId,
    );
    if (contactId) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".contacts WHERE id = $1::uuid`,
        contactId,
      );
    }
  });

  it('retorna 422 quando template IMAGE não recebe mídia de cabeçalho', async () => {
    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader())
      .send({
        contactId,
        channelId,
        templateName: 'ao_test_image',
        templateLanguage: 'pt_BR',
        useTemplate: true,
      });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('template.validation.missingHeaderMedia');
  });

  it('retorna 422 quando variável obrigatória do corpo não é preenchida', async () => {
    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader())
      .send({
        contactId,
        channelId,
        templateName: templateBodyVarName,
        templateLanguage: 'pt_BR',
        useTemplate: true,
        // bodyParameters ausente — nenhuma variável fornecida
      });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('template.validation.missingBodyVar');
  });

  it('retorna mensagem de erro em inglês com Accept-Language: en-US', async () => {
    const response = await createTestApp()
      .post('/api/omnichannel/active-outbound')
      .set(authHeader('en-US'))
      .send({
        contactId,
        channelId,
        templateName: 'ao_test_image',
        templateLanguage: 'pt_BR',
        useTemplate: true,
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('template.validation.missingHeaderMedia');
    expect(response.body.error.message).toBe('Template requires media in the header');
  });
});
