import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { upsertVoiceConfig } from '../admin/voice-config/voice-config.service.js';
import { ensureCallRecordsInfrastructure } from './calls.service.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_AUTH_SUB = '00000000-0000-0000-0000-000000000071';

function requireSchema(): string {
  const s = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!s) throw new Error('Schema de teste não inicializado');
  return s;
}

function requireTenantId(): string {
  const tenantId = globalThis.__ZIRADESK_TEST_TENANT_ID__;
  if (!tenantId) throw new Error('Tenant de teste não inicializado');
  return tenantId;
}

function authHeader(): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_AUTH_SUB,
      email: 'calls.integration@ziradesk.test',
      name: 'Calls Integration User',
      role: 'owner',
    })}`,
  };
}

describe('Calls integration', () => {
  it('provisiona a infraestrutura de chamadas entrantes de forma idempotente', async () => {
    const schema = requireSchema();

    await ensureCallRecordsInfrastructure(prisma, schema);
    await ensureCallRecordsInfrastructure(prisma, schema);

    const columns = await prisma.$queryRawUnsafe<Array<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>>(
      `SELECT column_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'call_records'
          AND column_name IN ('conversation_id', 'contact_id', 'direction', 'bot_option_id')`,
      schema,
    );
    const columnsByName = new Map(columns.map((column) => [column.column_name, column]));

    expect(columnsByName.get('conversation_id')?.is_nullable).toBe('YES');
    expect(columnsByName.get('contact_id')).toBeDefined();
    expect(columnsByName.get('bot_option_id')).toBeDefined();
    expect(columnsByName.get('direction')?.is_nullable).toBe('NO');
    expect(columnsByName.get('direction')?.column_default).toContain('outbound');

    const [infrastructure] = await prisma.$queryRawUnsafe<Array<{
      sessions_table: string | null;
      contact_index: string | null;
      session_call_sid_index: string | null;
    }>>(
      `SELECT
         to_regclass($1)::text AS sessions_table,
         to_regclass($2)::text AS contact_index,
         to_regclass($3)::text AS session_call_sid_index`,
      `${schema}.call_ivr_sessions`,
      `${schema}.idx_call_records_contact`,
      `${schema}.idx_call_ivr_sessions_call_sid`,
    );

    expect(infrastructure?.sessions_table).toBe(`${schema}.call_ivr_sessions`);
    expect(infrastructure?.contact_index).toBe(`${schema}.idx_call_records_contact`);
    expect(infrastructure?.session_call_sid_index).toBe(`${schema}.idx_call_ivr_sessions_call_sid`);
  });

  it('GET /api/calls/token retorna token Twilio para agente autenticado', async () => {
    const response = await createTestApp()
      .get('/api/calls/token')
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.token).toEqual(expect.any(String));
  });

  describe('IVR de chamada entrante', () => {
    const configuredPhone = `+1555${Date.now().toString().slice(-7)}`;
    const unknownPhone = '+15550000000';
    const callerPhone = '+5511999999999';
    const callSidPrefix = `CA_IVR_${Date.now()}`;
    let botMenuId: string;
    let financeOptionId: string;

    beforeAll(async () => {
      const schema = requireSchema();
      await ensureCallRecordsInfrastructure(prisma, schema);

      const [menu] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "${schema}".bot_menus (is_active, greeting, footer)
         VALUES (true, 'Menu de teste IVR', 'Escolha uma opção')
         RETURNING id`,
      );
      botMenuId = menu!.id;

      const options = await prisma.$queryRawUnsafe<Array<{ id: string; label: string }>>(
        `INSERT INTO "${schema}".bot_options
           (bot_menu_id, number, label, response, sort_order)
         VALUES
           ($1::uuid, 1, 'Financeiro', 'Transferindo para o financeiro.', 1),
           ($1::uuid, 2, 'Suporte técnico', 'Transferindo para o suporte.', 2)
         RETURNING id, label`,
        botMenuId,
      );
      financeOptionId = options.find((option) => option.label === 'Financeiro')!.id;

      await upsertVoiceConfig(requireTenantId(), {
        twilioPhoneNumber: configuredPhone,
        defaultBotMenuId: botMenuId,
        ivrEnabled: true,
        ringTimeoutSeconds: 20,
      });
    });

    afterAll(async () => {
      const schema = requireSchema();
      await prisma.$executeRawUnsafe(
        'DELETE FROM public.tenant_voice_config WHERE tenant_id = $1',
        requireTenantId(),
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".call_ivr_sessions WHERE call_sid LIKE $1`,
        `${callSidPrefix}%`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".call_records WHERE call_sid LIKE $1`,
        `${callSidPrefix}%`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".bot_menus WHERE id = $1::uuid`,
        botMenuId,
      );
    });

    it('retorna TwiML de erro para número não configurado', async () => {
      const response = await createTestApp()
        .post('/api/calls/incoming')
        .type('form')
        .send({
          To: unknownPhone,
          From: callerPhone,
          CallSid: `${callSidPrefix}_UNKNOWN`,
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/xml');
      expect(response.text).toContain('Este número não está configurado');
      expect(response.text).toContain('<Hangup/>');
    });

    it('retorna Gather com as opções do menu configurado', async () => {
      const response = await createTestApp()
        .post('/api/calls/incoming')
        .type('form')
        .send({
          To: configuredPhone,
          From: callerPhone,
          CallSid: `${callSidPrefix}_MENU`,
        });

      expect(response.status).toBe(200);
      expect(response.text).toContain('<Gather');
      expect(response.text).toContain('Financeiro');
      expect(response.text).toContain('Suporte técnico');
    });

    it('persiste a opção válida e avança a sessão para routing', async () => {
      const schema = requireSchema();
      const callSid = `${callSidPrefix}_VALID`;

      await createTestApp()
        .post('/api/calls/incoming')
        .type('form')
        .send({ To: configuredPhone, From: callerPhone, CallSid: callSid })
        .expect(200);

      const response = await createTestApp()
        .post('/api/calls/incoming/menu?attempt=1')
        .type('form')
        .send({
          To: configuredPhone,
          From: callerPhone,
          CallSid: callSid,
          Digits: '1',
        });

      const [session] = await prisma.$queryRawUnsafe<Array<{
        status: string;
        bot_option_id: string | null;
      }>>(
        `SELECT status, bot_option_id
           FROM "${schema}".call_ivr_sessions
          WHERE call_sid = $1`,
        callSid,
      );
      const [record] = await prisma.$queryRawUnsafe<Array<{
        bot_option_id: string | null;
      }>>(
        `SELECT bot_option_id
           FROM "${schema}".call_records
          WHERE call_sid = $1`,
        callSid,
      );

      expect(response.status).toBe(200);
      expect(session).toMatchObject({
        status: 'routing',
        bot_option_id: financeOptionId,
      });
      expect(record?.bot_option_id).toBe(financeOptionId);
    });

    it('repete o menu após a primeira opção inválida', async () => {
      const response = await createTestApp()
        .post('/api/calls/incoming/menu?attempt=1')
        .type('form')
        .send({
          To: configuredPhone,
          From: callerPhone,
          CallSid: `${callSidPrefix}_INVALID_1`,
          Digits: '9',
        });

      expect(response.status).toBe(200);
      expect(response.text).toContain('<Gather');
      expect(response.text).toContain('attempt=2');
      expect(response.text).toContain('Financeiro');
    });

    it('encerra após a segunda opção inválida sem repetir o Gather', async () => {
      const response = await createTestApp()
        .post('/api/calls/incoming/menu?attempt=2')
        .type('form')
        .send({
          To: configuredPhone,
          From: callerPhone,
          CallSid: `${callSidPrefix}_INVALID_2`,
          Digits: '9',
        });

      expect(response.status).toBe(200);
      expect(response.text).toContain('<Hangup/>');
      expect(response.text).not.toContain('<Gather');
    });
  });

  describe('GET /api/calls/conversation/:id', () => {
    let conversationId: string;
    const callSid = `CA_INTTEST_${Date.now()}`;

    beforeAll(async () => {
      const schema = requireSchema();

      const [contact] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "${schema}".contacts (name) VALUES ('Calls Conv Contact') RETURNING id`,
      );

      const [conversation] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "${schema}".conversations (contact_id, channel_type)
         VALUES ($1::uuid, 'voice') RETURNING id`,
        contact!.id,
      );
      conversationId = conversation!.id;

      // Garante que a tabela call_records existe (criada lazily pelo serviço)
      await ensureCallRecordsInfrastructure(prisma, schema);

      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}".call_records
           (call_sid, to_phone, from_phone, status, conversation_id, agent_id)
         VALUES ($1, '+5511999999999', '+15550000000', 'completed', $2::uuid, $3::uuid)`,
        callSid,
        conversationId,
        TEST_USER_ID,
      );
    });

    afterAll(async () => {
      const schema = requireSchema();
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".call_records WHERE call_sid = $1`,
        callSid,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".conversations WHERE id = $1::uuid`,
        conversationId,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".contacts WHERE name = 'Calls Conv Contact'`,
      );
    });

    it('retorna lista de registros de chamada para a conversa', async () => {
      const response = await createTestApp()
        .get(`/api/calls/conversation/${conversationId}`)
        .set(authHeader());

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ call_sid: callSid, status: 'completed' }),
        ]),
      );
    });
  });
});
