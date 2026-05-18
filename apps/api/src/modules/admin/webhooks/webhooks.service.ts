import { prisma } from '../../../config/database.js';
import type { CreateWebhookInput, UpdateWebhookInput } from './webhooks.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  events: string[];
  headers: Record<string, string>;
  is_active: boolean;
  last_triggered_at: Date | null;
  last_status: number | null;
  created_at: Date;
  updated_at: Date;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureWebhooksTable(schemaName: string): Promise<void> {
  const schema = quoteIdent(schemaName);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.outbound_webhooks (
      id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      name              VARCHAR(100) NOT NULL,
      url               VARCHAR(500) NOT NULL,
      secret            VARCHAR(255),
      events            TEXT[]       NOT NULL DEFAULT '{}',
      headers           JSONB        DEFAULT '{}',
      is_active         BOOLEAN      DEFAULT true,
      last_triggered_at TIMESTAMPTZ,
      last_status       INTEGER,
      created_at        TIMESTAMPTZ  DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

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
      status_map      JSONB DEFAULT '{}'::jsonb,
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
      integration_id   UUID REFERENCES ${schema}.redmine_integrations(id),
      last_synced_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticket_id, integration_id)
    )
  `);
}

export async function listWebhooks(schemaName: string): Promise<WebhookRow[]> {
  await ensureWebhooksTable(schemaName);
  const schema = quoteIdent(schemaName);
  return prisma.$queryRawUnsafe<WebhookRow[]>(`
    SELECT id, name, url, secret, events, headers, is_active,
           last_triggered_at, last_status, created_at, updated_at
    FROM ${schema}.outbound_webhooks
    ORDER BY created_at DESC
  `);
}

export async function getWebhook(schemaName: string, id: string): Promise<WebhookRow> {
  await ensureWebhooksTable(schemaName);
  const schema = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<WebhookRow[]>(
    `SELECT id, name, url, secret, events, headers, is_active,
            last_triggered_at, last_status, created_at, updated_at
     FROM ${schema}.outbound_webhooks
     WHERE id = $1::uuid
     LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Webhook');
  return rows[0];
}

export async function createWebhook(schemaName: string, data: CreateWebhookInput): Promise<WebhookRow> {
  await ensureWebhooksTable(schemaName);
  const schema = quoteIdent(schemaName);
  const eventsLiteral = `{${data.events.map((e) => `"${e}"`).join(',')}}`;
  const headersJson = JSON.stringify(data.headers ?? {});

  const rows = await prisma.$queryRawUnsafe<WebhookRow[]>(
    `INSERT INTO ${schema}.outbound_webhooks (name, url, secret, events, headers, is_active)
     VALUES ($1, $2, $3, $4::text[], $5::jsonb, $6)
     RETURNING id, name, url, secret, events, headers, is_active,
               last_triggered_at, last_status, created_at, updated_at`,
    data.name,
    data.url,
    data.secret ?? null,
    eventsLiteral,
    headersJson,
    data.isActive,
  );

  return rows[0]!;
}

export async function updateWebhook(
  schemaName: string,
  id: string,
  data: UpdateWebhookInput,
): Promise<WebhookRow> {
  await ensureWebhooksTable(schemaName);
  const schema = quoteIdent(schemaName);

  const existing = await getWebhook(schemaName, id);

  const name = data.name ?? existing.name;
  const url = data.url ?? existing.url;
  const secret = data.secret !== undefined ? data.secret : existing.secret;
  const events = data.events ?? existing.events;
  const headers = data.headers !== undefined ? data.headers : existing.headers;
  const isActive = data.isActive !== undefined ? data.isActive : existing.is_active;

  const eventsLiteral = `{${events.map((e) => `"${e}"`).join(',')}}`;
  const headersJson = JSON.stringify(headers);

  const rows = await prisma.$queryRawUnsafe<WebhookRow[]>(
    `UPDATE ${schema}.outbound_webhooks
     SET name = $1, url = $2, secret = $3, events = $4::text[],
         headers = $5::jsonb, is_active = $6, updated_at = NOW()
     WHERE id = $7::uuid
     RETURNING id, name, url, secret, events, headers, is_active,
               last_triggered_at, last_status, created_at, updated_at`,
    name,
    url,
    secret ?? null,
    eventsLiteral,
    headersJson,
    isActive,
    id,
  );

  return rows[0]!;
}

export async function deleteWebhook(schemaName: string, id: string): Promise<WebhookRow> {
  await ensureWebhooksTable(schemaName);
  const schema = quoteIdent(schemaName);

  const rows = await prisma.$queryRawUnsafe<WebhookRow[]>(
    `DELETE FROM ${schema}.outbound_webhooks
     WHERE id = $1::uuid
     RETURNING id, name, url, secret, events, headers, is_active,
               last_triggered_at, last_status, created_at, updated_at`,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Webhook');
  return rows[0];
}
