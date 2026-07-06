import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/database.js';
import { createTestApp } from '../../../test/setup.js';

function requireSchema(): string {
  const s = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!s) throw new Error('Schema de teste não inicializado');
  return s;
}

function requireTenantSlug(): string {
  const slug = globalThis.__ZIRADESK_TEST_TENANT_SLUG__;
  if (!slug) throw new Error('Tenant slug de teste não inicializado');
  return slug;
}

async function ensureRedmineTables(schema: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${schema}".redmine_integrations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(100) NOT NULL DEFAULT 'Redmine',
      redmine_url     VARCHAR(500) NOT NULL,
      api_key         VARCHAR(255) NOT NULL,
      project_id      VARCHAR(100) NOT NULL,
      is_active       BOOLEAN DEFAULT true,
      sync_comments   BOOLEAN DEFAULT true,
      sync_status     BOOLEAN DEFAULT true,
      sync_company    BOOLEAN DEFAULT true,
      status_map      JSONB DEFAULT '{}'::jsonb,
      priority_map    JSONB DEFAULT '{}'::jsonb,
      last_sync_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${schema}".redmine_ticket_map (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id        UUID NOT NULL,
      redmine_issue_id INTEGER NOT NULL,
      redmine_company_id INTEGER,
      integration_id   UUID REFERENCES "${schema}".redmine_integrations(id),
      last_synced_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticket_id, integration_id)
    )
  `);
}

describe('Redmine webhook integration', () => {
  let ticketId: string;
  let integrationId: string;
  const REDMINE_ISSUE_ID = 9901;

  beforeAll(async () => {
    const schema = requireSchema();

    await ensureRedmineTables(schema);

    // Insere ticket de teste
    const [ticket] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${schema}".tickets (title, status, priority, source)
       VALUES ('Título Original', 'open', 'medium', 'manual')
       RETURNING id`,
    );
    ticketId = ticket!.id;

    // Insere integração Redmine com credenciais em formato JSON simples
    // (decryptCredentials aceita objeto JSON inline)
    const [integration] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${schema}".redmine_integrations
         (redmine_url, api_key, project_id, is_active, sync_status, sync_company, sync_comments)
       VALUES ($1, $2, $3, true, true, false, false)
       RETURNING id`,
      'https://redmine.ziradesk.test',
      '{"api_key":"test_redmine_key"}',
      'test-project',
    );
    integrationId = integration!.id;

    // Mapeia ticket → issue do Redmine
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".redmine_ticket_map (ticket_id, redmine_issue_id, integration_id)
       VALUES ($1::uuid, $2::integer, $3::uuid)`,
      ticketId,
      REDMINE_ISSUE_ID,
      integrationId,
    );
  });

  afterAll(async () => {
    const schema = requireSchema();
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${schema}".redmine_ticket_map WHERE integration_id = $1::uuid`,
      integrationId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${schema}".redmine_integrations WHERE id = $1::uuid`,
      integrationId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${schema}".tickets WHERE id = $1::uuid`,
      ticketId,
    );
  });

  it('POST /api/webhooks/redmine/:slug com payload válido retorna 200 imediatamente e sincroniza ticket', async () => {
    const slug = requireTenantSlug();

    const response = await createTestApp()
      .post(`/api/webhooks/redmine/${slug}`)
      .send({
        issue: {
          id: REDMINE_ISSUE_ID,
          subject: 'Título Atualizado pelo Redmine',
          status: { id: 3, name: 'Resolved' },
        },
      });

    // Rota retorna 200 imediatamente (processamento é async)
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    // Aguarda o processamento assíncrono concluir
    await new Promise((r) => setTimeout(r, 2000));

    const schema = requireSchema();
    const [updated] = await prisma.$queryRawUnsafe<Array<{ title: string; status: string }>>(
      `SELECT title, status FROM "${schema}".tickets WHERE id = $1::uuid`,
      ticketId,
    );

    expect(updated!.title).toBe('Título Atualizado pelo Redmine');
    expect(updated!.status).toBe('resolved');
  });

  it('POST /api/webhooks/redmine/:slug com tenant inexistente retorna 404', async () => {
    const response = await createTestApp()
      .post('/api/webhooks/redmine/tenant-nao-existe-xyzabc')
      .send({ issue: { id: 1 } });

    expect(response.status).toBe(404);
  });
});
