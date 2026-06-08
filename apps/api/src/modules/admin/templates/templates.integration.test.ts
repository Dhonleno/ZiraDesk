import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../config/database.js';
import { createTestApp, createTestJWT } from '../../../test/setup.js';
import {
  createTemplate,
  syncTemplatesFromMeta,
  updateTemplate,
  updateTemplateStatusFromMeta,
} from './templates.service.js';

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

  it('createTemplate envia o template à Meta e persiste o status retornado', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: 'meta_created_001',
        status: 'PENDING',
        category: 'UTILITY',
      }),
    }));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const data = await createTemplate(requireSchema(), {
        channelId,
        technicalName: 'boas_vindas_teste',
        displayName: 'Boas-vindas Teste',
        language: 'pt_BR',
        category: 'UTILITY',
        body: 'Olá {{1}}, seu chamado {{2}} foi aberto.',
        headerType: 'none',
        variables: [
          { index: '1', example: 'Maria' },
          { index: '2', example: 'ZD-123' },
        ],
      });

      expect(data).toMatchObject({
        name: 'boas_vindas_teste',
        display_name: 'Boas-vindas Teste',
        language: 'pt_BR',
        category: 'UTILITY',
        status: 'pending',
        channel_id: channelId,
        meta_template_id: 'meta_created_001',
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(String(url)).toContain('/test_waba_id/message_templates');
      expect(JSON.parse(String(options?.body))).toMatchObject({
        name: 'boas_vindas_teste',
        language: 'pt_BR',
        category: 'UTILITY',
        components: expect.arrayContaining([
          expect.objectContaining({
            type: 'BODY',
            text: 'Olá {{1}}, seu chamado {{2}} foi aberto.',
            example: { body_text: [['Maria', 'ZD-123']] },
          }),
        ]),
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('createTemplate envia cabeçalho de imagem com o header_handle da Meta', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: 'meta_created_media_001',
        status: 'PENDING',
        category: 'MARKETING',
      }),
    }));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const data = await createTemplate(requireSchema(), {
        channelId,
        technicalName: 'campanha_imagem_criacao',
        displayName: 'Campanha com imagem',
        language: 'pt_BR',
        category: 'MARKETING',
        body: 'Confira nossa novidade.',
        headerType: 'image',
        headerHandle: 'meta-upload-handle-001',
        variables: [],
      });

      expect(data).toMatchObject({
        header: null,
        header_type: 'IMAGE',
        meta_template_id: 'meta_created_media_001',
      });

      const [, options] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(String(options?.body))).toMatchObject({
        components: expect.arrayContaining([
          {
            type: 'HEADER',
            format: 'IMAGE',
            example: {
              header_handle: ['meta-upload-handle-001'],
            },
          },
        ]),
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('updateTemplateStatusFromMeta atualiza o status sem intervenção do usuário', async () => {
    const updated = await updateTemplateStatusFromMeta(requireSchema(), channelId, {
      templateId: 'meta_created_001',
      templateName: 'boas_vindas_teste',
      language: 'pt_BR',
      event: 'APPROVED',
    });

    expect(updated).toBe(1);

    const rows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT status
       FROM "${requireSchema()}".whatsapp_templates
       WHERE channel_id = $1::uuid
         AND meta_template_id = 'meta_created_001'
       LIMIT 1`,
      channelId,
    );
    expect(rows[0]?.status).toBe('approved');
  });

  it('updateTemplate submete à Meta um template legado ainda não vinculado', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${requireSchema()}".whatsapp_templates
        (channel_id, name, display_name, language, category, body, variables, status)
       VALUES ($1::uuid, 'template_legado', 'Template legado', 'pt_BR', 'UTILITY',
               'Olá {{1}}', '[{"index":"1","example":"Carlos"}]'::jsonb, 'approved')
       RETURNING id`,
      channelId,
    );

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: 'meta_legacy_001',
        status: 'PENDING',
        category: 'UTILITY',
      }),
    })));

    try {
      const updated = await updateTemplate(requireSchema(), rows[0]!.id, {
        displayName: 'Template legado enviado',
      });

      expect(updated).toMatchObject({
        display_name: 'Template legado enviado',
        status: 'pending',
        meta_template_id: 'meta_legacy_001',
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
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
