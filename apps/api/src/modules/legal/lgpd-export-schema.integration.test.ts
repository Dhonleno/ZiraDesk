import { randomUUID } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { validateExportPayload } from '../../lib/lgpd/validate-export.js';

function authHeader(): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT()}`,
  };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}@ziradesk.test`.toLowerCase();
}

function uniquePhone(seed: number): string {
  return `+55119${seed.toString().padStart(8, '0')}`;
}

function uniqueDocument(seed: number): string {
  return `${seed.toString().padStart(11, '0')}`;
}

describe('LGPD Export Schema API', () => {
  it('GET /api/legal/lgpd-export-schema retorna 200 com schema público', async () => {
    const response = await createTestApp().get('/api/legal/lgpd-export-schema');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/schema+json');
    expect(response.headers['cache-control']).toContain('public');
    expect(response.headers['cache-control']).toContain('max-age=86400');
    expect(response.body).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://ziradesk.com.br/schemas/lgpd-export-v1.json',
      title: 'ZiraDesk LGPD Data Export Schema',
      properties: {
        schema_version: {
          const: '1.2.0',
        },
      },
    });
    expect(response.body.$defs.tenantId).toMatchObject({
      type: 'string',
      pattern: '^c[a-z0-9]{24}$',
      description: 'cuid — usado apenas no schema public (tenant_id, plan_id)',
    });
    expect(response.body.$defs.entityId).toMatchObject({
      type: 'string',
      format: 'uuid',
      description: 'UUID v4 — usado em entidades dentro do schema tenant',
    });
  });

  it('schema compila no ajv sem erro', async () => {
    const response = await createTestApp().get('/api/legal/lgpd-export-schema');

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const addFormatsPlugin = addFormats as unknown as (instance: Ajv2020) => void;
    addFormatsPlugin(ajv);

    const validate = ajv.compile(response.body);
    expect(typeof validate).toBe('function');
  });

  it('output de exportContactLgpdData passa na validação', async () => {
    const contactResponse = await createTestApp()
      .post('/api/crm/contacts')
      .set(authHeader())
      .send({
        name: `Contato LGPD ${Date.now()}`,
        email: uniqueEmail('lgpd.contact'),
        phone: uniquePhone(501),
        document: uniqueDocument(501),
      });

    expect(contactResponse.status).toBe(201);
    const contactId = contactResponse.body.data.id as string;

    const response = await createTestApp()
      .get(`/api/crm/contacts/${contactId}/lgpd/export`)
      .query({ include_messages: true })
      .set(authHeader());

    if (response.status !== 200) {
      // eslint-disable-next-line no-console
      console.log('LGPD contact export error payload', response.body);
    }
    expect(response.status).toBe(200);
    const validation = validateExportPayload(response.body.data);
    expect(validation.valid).toBe(true);
  });

  it('output de exportUserLgpdData passa na validação', async () => {
    const response = await createTestApp()
      .get('/api/auth/me/lgpd/export')
      .set(authHeader());

    expect(response.status).toBe(200);
    const validation = validateExportPayload(response.body.data);
    expect(validation.valid).toBe(true);
  });

  it('payload com campo extra é tolerado', async () => {
    const response = await createTestApp()
      .get('/api/auth/me/lgpd/export')
      .set(authHeader());

    expect(response.status).toBe(200);

    const payload = {
      ...(response.body.data as Record<string, unknown>),
      integration_marker: `extra-${randomUUID()}`,
    };

    const validation = validateExportPayload(payload);
    expect(validation.valid).toBe(true);
  });

  it('payload sem campo obrigatório é detectado como inválido', async () => {
    const response = await createTestApp()
      .get('/api/auth/me/lgpd/export')
      .set(authHeader());

    expect(response.status).toBe(200);

    const payload = { ...(response.body.data as Record<string, unknown>) };
    delete payload['exported_at'];

    const validation = validateExportPayload(payload);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it('payload com metadata.tenant_id em UUID é inválido', async () => {
    const response = await createTestApp()
      .get('/api/auth/me/lgpd/export')
      .set(authHeader());

    expect(response.status).toBe(200);

    const payload = structuredClone(response.body.data as Record<string, unknown>);
    const metadata = payload.metadata as Record<string, unknown>;
    metadata.tenant_id = '550e8400-e29b-41d4-a716-446655440000';

    const validation = validateExportPayload(payload);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('/metadata/tenant_id'))).toBe(true);
  });

  it('payload com subject.id em cuid é inválido', async () => {
    const response = await createTestApp()
      .get('/api/auth/me/lgpd/export')
      .set(authHeader());

    expect(response.status).toBe(200);

    const payload = structuredClone(response.body.data as Record<string, unknown>);
    const subject = payload.subject as Record<string, unknown>;
    subject.id = 'c1234567890abcdefghijklmn';

    const validation = validateExportPayload(payload);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('/subject/id'))).toBe(true);
  });
});
