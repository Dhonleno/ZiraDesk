import { prisma } from '../../../config/database.js';
import { encryptCredentials, decryptCredentials } from '../../../utils/crypto.js';
import type { RedmineCreateInput, RedmineUpdateInput } from './redmine.schema.js';

interface RedmineIntegrationRow {
  id: string;
  name: string;
  redmine_url: string;
  api_key: string;
  project_id: string;
  is_active: boolean;
  sync_comments: boolean;
  sync_status: boolean;
  sync_company: boolean;
  status_map: unknown;
  priority_map: unknown;
  last_sync_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface RedmineIntegrationPublic extends Omit<RedmineIntegrationRow, 'api_key'> {
  has_api_key: boolean;
  api_key_masked: string | null;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeStatusMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const numeric = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(numeric)) output[k] = numeric;
  }
  return output;
}

export async function ensureRedmineInfrastructure(schemaName: string): Promise<void> {
  const schema = quoteIdent(schemaName);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.redmine_integrations (
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
    CREATE TABLE IF NOT EXISTS ${schema}.redmine_ticket_map (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id        UUID NOT NULL,
      redmine_issue_id INTEGER NOT NULL,
      redmine_company_id INTEGER,
      integration_id   UUID REFERENCES ${schema}.redmine_integrations(id),
      last_synced_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticket_id, integration_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.redmine_integrations
    ADD COLUMN IF NOT EXISTS sync_company BOOLEAN DEFAULT true
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.redmine_integrations
    ADD COLUMN IF NOT EXISTS priority_map JSONB DEFAULT '{}'::jsonb
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.redmine_ticket_map
    ADD COLUMN IF NOT EXISTS redmine_company_id INTEGER
  `);
}

function toPublic(row: RedmineIntegrationRow | null): RedmineIntegrationPublic | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    redmine_url: row.redmine_url,
    project_id: row.project_id,
    is_active: row.is_active,
    sync_comments: row.sync_comments,
    sync_status: row.sync_status,
    sync_company: row.sync_company,
    status_map: normalizeStatusMap(row.status_map),
    priority_map: normalizeStatusMap(row.priority_map),
    last_sync_at: row.last_sync_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_api_key: Boolean(row.api_key),
    api_key_masked: row.api_key ? '••••••••' : null,
  };
}

export async function getRedmineIntegration(schemaName: string): Promise<RedmineIntegrationPublic | null> {
  await ensureRedmineInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<RedmineIntegrationRow[]>(
    `SELECT id, name, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, sync_company,
            status_map, priority_map, last_sync_at, created_at, updated_at
     FROM ${schema}.redmine_integrations
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  return toPublic(rows[0] ?? null);
}

export async function createOrSaveRedmineIntegration(
  schemaName: string,
  data: RedmineCreateInput,
): Promise<RedmineIntegrationPublic> {
  await ensureRedmineInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);
  const encryptedApiKey = encryptCredentials({ api_key: data.apiKey });

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM ${schema}.redmine_integrations ORDER BY created_at ASC LIMIT 1`,
  );

  if (!existing[0]) {
    const inserted = await prisma.$queryRawUnsafe<RedmineIntegrationRow[]>(
      `INSERT INTO ${schema}.redmine_integrations
         (name, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, sync_company, status_map, updated_at)
       VALUES
         ($1, $2, $3, $4, COALESCE($5, true), COALESCE($6, true), COALESCE($7, true), COALESCE($8, true), $9::jsonb, NOW())
       RETURNING id, name, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, sync_company,
                 status_map, priority_map, last_sync_at, created_at, updated_at`,
      data.name,
      data.redmineUrl,
      encryptedApiKey,
      data.projectId,
      data.isActive ?? true,
      data.syncComments ?? true,
      data.syncStatus ?? true,
      data.syncCompany ?? true,
      JSON.stringify(data.statusMap ?? {}),
    );

    return toPublic(inserted[0]!)!;
  }

  const updated = await prisma.$queryRawUnsafe<RedmineIntegrationRow[]>(
    `UPDATE ${schema}.redmine_integrations
     SET name = $1,
         redmine_url = $2,
         api_key = $3,
         project_id = $4,
         is_active = COALESCE($5, is_active),
         sync_comments = COALESCE($6, sync_comments),
         sync_status = COALESCE($7, sync_status),
         sync_company = COALESCE($8, sync_company),
         status_map = $9::jsonb,
         updated_at = NOW()
     WHERE id = $10::uuid
     RETURNING id, name, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, sync_company,
               status_map, priority_map, last_sync_at, created_at, updated_at`,
    data.name,
    data.redmineUrl,
    encryptedApiKey,
    data.projectId,
    data.isActive ?? null,
    data.syncComments ?? null,
    data.syncStatus ?? null,
    data.syncCompany ?? null,
    JSON.stringify(data.statusMap ?? {}),
    existing[0].id,
  );

  return toPublic(updated[0]!)!;
}

export async function updateRedmineIntegration(
  schemaName: string,
  data: RedmineUpdateInput,
): Promise<RedmineIntegrationPublic | null> {
  await ensureRedmineInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);
  const currentRows = await prisma.$queryRawUnsafe<RedmineIntegrationRow[]>(
    `SELECT id, name, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, sync_company,
            status_map, priority_map, last_sync_at, created_at, updated_at
     FROM ${schema}.redmine_integrations
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  const current = currentRows[0];
  if (!current) return null;

  const nextApiKey = data.apiKey ? encryptCredentials({ api_key: data.apiKey }) : current.api_key;
  const nextStatusMap = data.statusMap ? normalizeStatusMap(data.statusMap) : normalizeStatusMap(current.status_map);

  const rows = await prisma.$queryRawUnsafe<RedmineIntegrationRow[]>(
    `UPDATE ${schema}.redmine_integrations
     SET name = COALESCE($1, name),
         redmine_url = COALESCE($2, redmine_url),
         api_key = $3,
         project_id = COALESCE($4, project_id),
         is_active = COALESCE($5, is_active),
         sync_comments = COALESCE($6, sync_comments),
         sync_status = COALESCE($7, sync_status),
         sync_company = COALESCE($8, sync_company),
         status_map = $9::jsonb,
         updated_at = NOW()
     WHERE id = $10::uuid
     RETURNING id, name, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, sync_company,
               status_map, priority_map, last_sync_at, created_at, updated_at`,
    data.name ?? null,
    data.redmineUrl ?? null,
    nextApiKey,
    data.projectId ?? null,
    data.isActive ?? null,
    data.syncComments ?? null,
    data.syncStatus ?? null,
    data.syncCompany ?? null,
    JSON.stringify(nextStatusMap),
    current.id,
  );

  return toPublic(rows[0]!)!;
}

export async function deleteRedmineIntegration(schemaName: string): Promise<boolean> {
  await ensureRedmineInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);

  await prisma.$executeRawUnsafe(`DELETE FROM ${schema}.redmine_ticket_map`);
  const deleted = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `DELETE FROM ${schema}.redmine_integrations
     RETURNING id`,
  );
  return deleted.length > 0;
}

export async function testRedmineConnection(
  schemaName: string,
  input?: { redmineUrl?: string | undefined; apiKey?: string | undefined },
): Promise<boolean> {
  await ensureRedmineInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);

  let redmineUrl = input?.redmineUrl?.trim() ?? '';
  let apiKey = input?.apiKey?.trim() ?? '';

  if (!redmineUrl || !apiKey) {
    const rows = await prisma.$queryRawUnsafe<RedmineIntegrationRow[]>(
      `SELECT id, name, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, sync_company,
              status_map, priority_map, last_sync_at, created_at, updated_at
       FROM ${schema}.redmine_integrations
       ORDER BY created_at ASC
       LIMIT 1`,
    );
    const current = rows[0];
    if (!current) return false;
    redmineUrl = redmineUrl || current.redmine_url;
    const creds = decryptCredentials(current.api_key);
    apiKey = apiKey || creds['api_key'] || '';
  }

  if (!redmineUrl || !apiKey) return false;

  const response = await fetch(`${redmineUrl.replace(/\/+$/, '')}/projects.json`, {
    method: 'GET',
    headers: { 'X-Redmine-API-Key': apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  return response.ok;
}
