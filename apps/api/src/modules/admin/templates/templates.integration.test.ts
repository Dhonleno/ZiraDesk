import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../config/database.js';
import { createTestApp, createTestJWT } from '../../../test/setup.js';
import { syncTemplatesFromMeta } from './templates.service.js';

const TEST_AUTH_SUB = '00000000-0000-0000-0000-000000000073';

function requireSchema(): string {
  const s = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!s) throw new Error('Schema de teste não inicializado');
  return s;
}

function authHeader(): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_AUTH_SUB,
      email: 'templates.integration@ziradesk.test',
      name: 'Templates Integration User',
      role: 'owner',
    })}`,
  };
}

describe('Templates (WhatsApp) integration', () => {
  let channelId: string;

  beforeAll(async () => {
    const schema = requireSchema();

    // Cria canal WhatsApp com credenciais mínimas para sync
    const [channel] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${schema}".channels (type, name, credentials, status)
       VALUES ('whatsapp', 'WA Templates Test', $1::jsonb, 'active')
       RETURNING id`,
      JSON.stringify({ accessToken: 'test_access_token', wabaId: 'test_waba_id' }),
    );
    channelId = channel!.id;
  });

  afterAll(async () => {
    const schema = requireSchema();
    // whatsapp_templates tem ON DELETE CASCADE para channels
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${schema}".channels WHERE id = $1::uuid`,
      channelId,
    );
  });

  it('GET /api/admin/templates lista templates do tenant (pode ser vazia)', async () => {
    const response = await createTestApp()
      .get('/api/admin/templates')
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('POST /api/admin/templates cria template e retorna objeto persistido', async () => {
    const response = await createTestApp()
      .post('/api/admin/templates')
      .set(authHeader())
      .send({
        channelId,
        technicalName: 'boas_vindas_teste',
        displayName: 'Boas-vindas Teste',
        language: 'pt_BR',
        category: 'UTILITY',
        body: 'Olá {{nome}}, seu chamado {{numero}} foi aberto.',
        status: 'approved',
        variables: [],
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      name: 'boas_vindas_teste',
      display_name: 'Boas-vindas Teste',
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'approved',
      channel_id: channelId,
    });
    // Variáveis extraídas automaticamente do body quando não enviadas
    expect(Array.isArray(response.body.data.variables)).toBe(true);
  });

  it('syncTemplatesFromMeta sincroniza headers IMAGE, TEXT e NONE da Meta', async () => {
    // O servidor HTTP roda em processo separado (global-setup), então vi.stubGlobal não o afeta.
    // Chamamos o serviço diretamente do worker de teste — aqui o fetch já está mockado pelo vitest.setup.ts
    // e podemos substituí-lo por uma implementação que retorna payload válido da Meta.
    const metaPayload = JSON.stringify({
      data: [
        {
          id: 'meta_tmpl_001',
          name: 'suporte_abertura',
          language: 'pt_BR',
          status: 'APPROVED',
          category: 'UTILITY',
          components: [
            { type: 'BODY', text: 'Seu chamado {{1}} foi registrado. Aguarde.' },
          ],
        },
        {
          id: 'meta_tmpl_002',
          name: 'campanha_imagem',
          language: 'pt_BR',
          status: 'APPROVED',
          category: 'MARKETING',
          components: [
            {
              type: 'HEADER',
              format: 'IMAGE',
              example: { header_handle: ['https://cdn.example.com/header.jpg'] },
            },
            { type: 'BODY', text: 'Oferta para {{1}}.' },
            {
              type: 'BUTTONS',
              buttons: [{ type: 'URL', text: 'Comprar', url: 'https://example.com' }],
            },
          ],
        },
        {
          id: 'meta_tmpl_003',
          name: 'aviso_texto',
          language: 'pt_BR',
          status: 'APPROVED',
          category: 'UTILITY',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Aviso importante' },
            { type: 'BODY', text: 'Olá {{1}}.' },
          ],
        },
      ],
      paging: {},
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => metaPayload,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    })));

    try {
      const schema = requireSchema();
      const result = await syncTemplatesFromMeta(schema, channelId);

      expect(result.count).toBe(3);
      expect(result.templates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'suporte_abertura',
            language: 'pt_BR',
            status: 'approved',
            header_type: 'NONE',
          }),
          expect.objectContaining({
            name: 'campanha_imagem',
            header_type: 'IMAGE',
            header_example_url: 'https://cdn.example.com/header.jpg',
            components: expect.arrayContaining([
              expect.objectContaining({ type: 'HEADER', format: 'IMAGE' }),
            ]),
            buttons: expect.arrayContaining([
              expect.objectContaining({ type: 'URL', text: 'Comprar' }),
            ]),
          }),
          expect.objectContaining({
            name: 'aviso_texto',
            header: 'Aviso importante',
            header_type: 'TEXT',
          }),
        ]),
      );
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });
});
