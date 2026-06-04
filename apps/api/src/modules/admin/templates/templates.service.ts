import { prisma } from '../../../config/database.js';
import { decryptCredentials } from '../../../utils/crypto.js';
import type {
  CreateTemplateInput,
  ListTemplatesQuery,
  TemplateVariableInput,
  UpdateTemplateInput,
} from './templates.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

interface TemplateRow {
  id: string;
  channel_id: string;
  name: string;
  display_name: string;
  language: string;
  category: string;
  body: string;
  header: string | null;
  header_type: string;
  header_example_url: string | null;
  footer: string | null;
  variables: unknown;
  components: unknown;
  buttons: unknown;
  status: string;
  meta_template_id: string | null;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ChannelRow {
  id: string;
  type: string;
  status: string;
  credentials: string | object | null;
}

interface MetaTemplateComponent {
  type?: string;
  text?: string;
  format?: string;
  example?: {
    header_handle?: unknown;
  };
  buttons?: unknown;
}

interface MetaTemplate {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: MetaTemplateComponent[];
}

interface MetaTemplatesResponse {
  data?: MetaTemplate[];
  paging?: {
    cursors?: {
      after?: string;
    };
  };
}

interface SyncResult {
  count: number;
  templates: TemplateRow[];
}

const META_GRAPH_VERSION = 'v19.0';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeVariables(raw: unknown): TemplateVariableInput[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const index = typeof item.index === 'string' ? item.index.trim() : '';
      const example = typeof item.example === 'string' ? item.example.trim() : '';
      return { index, example };
    })
    .filter((item) => item.index.length > 0);
}

function normalizeJsonArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function extractVariablesFromBody(body: string): TemplateVariableInput[] {
  const regex = /\{\{\s*([^{}\s]+)\s*\}\}/g;
  const unique = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    if (match[1]) unique.add(match[1]);
  }

  return Array.from(unique)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((index) => ({ index, example: '' }));
}

function normalizeMetaStatus(status: string | undefined): 'approved' | 'pending' | 'rejected' {
  const value = (status ?? '').trim().toUpperCase();
  if (value.includes('APPROVED')) return 'approved';
  if (value.includes('REJECTED')) return 'rejected';
  return 'pending';
}

function normalizeMetaLanguage(language: string | undefined): 'pt_BR' | 'en_US' | 'es' {
  const value = (language ?? '').trim();
  if (value === 'pt_BR') return 'pt_BR';
  if (value === 'en_US') return 'en_US';
  if (value === 'es') return 'es';

  const lower = value.toLowerCase();
  if (lower.startsWith('pt')) return 'pt_BR';
  if (lower.startsWith('en')) return 'en_US';
  if (lower.startsWith('es')) return 'es';
  return 'pt_BR';
}

function normalizeMetaCategory(category: string | undefined): 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' {
  const value = (category ?? '').trim().toUpperCase();
  if (value === 'UTILITY') return 'UTILITY';
  if (value === 'AUTHENTICATION') return 'AUTHENTICATION';
  return 'MARKETING';
}

function normalizeHeaderType(format: string | undefined): 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' {
  const value = (format ?? '').trim().toUpperCase();
  if (value === 'TEXT') return 'TEXT';
  if (value === 'IMAGE') return 'IMAGE';
  if (value === 'VIDEO') return 'VIDEO';
  if (value === 'DOCUMENT') return 'DOCUMENT';
  return 'NONE';
}

function findMetaComponent(components: MetaTemplateComponent[] | undefined, type: string): MetaTemplateComponent | null {
  return (components ?? []).find((item) => item.type?.toUpperCase() === type) ?? null;
}

function extractHeaderExampleUrl(component: MetaTemplateComponent | null): string | null {
  const headerHandle = component?.example?.header_handle;
  if (Array.isArray(headerHandle)) {
    const firstHandle = typeof headerHandle[0] === 'string' ? headerHandle[0].trim() : '';
    return firstHandle || null;
  }
  if (typeof headerHandle === 'string') {
    const value = headerHandle.trim();
    return value || null;
  }
  return null;
}

function extractButtons(components: MetaTemplateComponent[] | undefined): unknown[] {
  const buttonsComponent = findMetaComponent(components, 'BUTTONS');
  return Array.isArray(buttonsComponent?.buttons) ? buttonsComponent.buttons : [];
}

function normalizeDisplayName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapTemplateRow(row: TemplateRow) {
  return {
    ...row,
    variables: normalizeVariables(row.variables),
    components: normalizeJsonArray(row.components),
    buttons: normalizeJsonArray(row.buttons),
  };
}

export async function ensureTemplatesInfrastructure(schemaName: string): Promise<void> {
  const schema = quoteIdent(schemaName);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.whatsapp_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id UUID NOT NULL REFERENCES ${schema}.channels(id) ON DELETE CASCADE,
      name VARCHAR(128) NOT NULL,
      display_name VARCHAR(180) NOT NULL,
      language VARCHAR(10) NOT NULL,
      category VARCHAR(32) NOT NULL,
      body TEXT NOT NULL,
      header TEXT,
      header_type VARCHAR(20) NOT NULL DEFAULT 'NONE',
      header_example_url TEXT,
      footer TEXT,
      variables JSONB NOT NULL DEFAULT '[]'::jsonb,
      components JSONB NOT NULL DEFAULT '[]'::jsonb,
      buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'approved',
      meta_template_id VARCHAR(80),
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT whatsapp_templates_unique_channel_name_language UNIQUE (channel_id, name, language)
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.whatsapp_templates
      ADD COLUMN IF NOT EXISTS header_type VARCHAR(20) NOT NULL DEFAULT 'NONE',
      ADD COLUMN IF NOT EXISTS header_example_url TEXT,
      ADD COLUMN IF NOT EXISTS components JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS buttons JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS whatsapp_templates_channel_status_idx
      ON ${schema}.whatsapp_templates(channel_id, status)
  `);
}

async function getChannel(schemaName: string, channelId: string): Promise<ChannelRow> {
  const schema = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, type, status, credentials
     FROM ${schema}.channels
     WHERE id = $1::uuid
     LIMIT 1`,
    channelId,
  );

  if (!rows[0]) throw new NotFoundError('Canal');
  return rows[0];
}

export async function listTemplates(schemaName: string, query: ListTemplatesQuery = {}) {
  await ensureTemplatesInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);

  const rows = query.channel_id
    ? await prisma.$queryRawUnsafe<TemplateRow[]>(
      `SELECT id, channel_id, name, display_name, language, category, body, header,
              header_type, header_example_url, footer, variables, components, buttons,
              status, meta_template_id, last_synced_at, created_at, updated_at
       FROM ${schema}.whatsapp_templates
       WHERE channel_id = $1::uuid
       ORDER BY display_name ASC, language ASC`,
      query.channel_id,
    )
    : await prisma.$queryRawUnsafe<TemplateRow[]>(
      `SELECT id, channel_id, name, display_name, language, category, body, header,
              header_type, header_example_url, footer, variables, components, buttons,
              status, meta_template_id, last_synced_at, created_at, updated_at
       FROM ${schema}.whatsapp_templates
       ORDER BY display_name ASC, language ASC`,
    );

  return rows.map(mapTemplateRow);
}

export async function createTemplate(schemaName: string, data: CreateTemplateInput) {
  await ensureTemplatesInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);

  const channel = await getChannel(schemaName, data.channelId);
  if (channel.type !== 'whatsapp') {
    throw new ValidationError('Templates só podem ser vinculados a canais WhatsApp');
  }

  const variables = data.variables.length > 0 ? data.variables : extractVariablesFromBody(data.body);

  const rows = await prisma.$queryRawUnsafe<TemplateRow[]>(
    `INSERT INTO ${schema}.whatsapp_templates
      (channel_id, name, display_name, language, category, body, header, footer, variables, status)
     VALUES
      ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     RETURNING id, channel_id, name, display_name, language, category, body, header,
               header_type, header_example_url, footer, variables, components, buttons,
               status, meta_template_id, last_synced_at, created_at, updated_at`,
    data.channelId,
    data.technicalName,
    data.displayName,
    data.language,
    data.category,
    data.body,
    data.header?.trim() || null,
    data.footer?.trim() || null,
    JSON.stringify(variables),
    data.status ?? 'approved',
  );

  return mapTemplateRow(rows[0]!);
}

export async function getTemplate(schemaName: string, id: string) {
  await ensureTemplatesInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);

  const rows = await prisma.$queryRawUnsafe<TemplateRow[]>(
    `SELECT id, channel_id, name, display_name, language, category, body, header,
            header_type, header_example_url, footer, variables, components, buttons,
            status, meta_template_id, last_synced_at, created_at, updated_at
     FROM ${schema}.whatsapp_templates
     WHERE id = $1::uuid
     LIMIT 1`,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Template');
  return mapTemplateRow(rows[0]);
}

export async function updateTemplate(schemaName: string, id: string, data: UpdateTemplateInput) {
  await ensureTemplatesInfrastructure(schemaName);

  const current = await getTemplate(schemaName, id);

  const channelId = data.channelId ?? current.channel_id;
  const technicalName = data.technicalName ?? current.name;
  const displayName = data.displayName ?? current.display_name;
  const language = data.language ?? current.language;
  const category = data.category ?? current.category;
  const body = data.body ?? current.body;
  const header = data.header !== undefined ? (data.header.trim() || null) : current.header;
  const footer = data.footer !== undefined ? (data.footer.trim() || null) : current.footer;
  const status = data.status ?? current.status;

  const variables = data.variables
    ? data.variables
    : normalizeVariables(current.variables).length > 0
      ? normalizeVariables(current.variables)
      : extractVariablesFromBody(body);

  const channel = await getChannel(schemaName, channelId);
  if (channel.type !== 'whatsapp') {
    throw new ValidationError('Templates só podem ser vinculados a canais WhatsApp');
  }

  const schema = quoteIdent(schemaName);

  const rows = await prisma.$queryRawUnsafe<TemplateRow[]>(
    `UPDATE ${schema}.whatsapp_templates
     SET channel_id = $1::uuid,
         name = $2,
         display_name = $3,
         language = $4,
         category = $5,
         body = $6,
         header = $7,
         footer = $8,
         variables = $9::jsonb,
         status = $10,
         updated_at = NOW()
     WHERE id = $11::uuid
     RETURNING id, channel_id, name, display_name, language, category, body, header,
               header_type, header_example_url, footer, variables, components, buttons,
               status, meta_template_id, last_synced_at, created_at, updated_at`,
    channelId,
    technicalName,
    displayName,
    language,
    category,
    body,
    header,
    footer,
    JSON.stringify(variables),
    status,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Template');
  return mapTemplateRow(rows[0]);
}

export async function deleteTemplate(schemaName: string, id: string) {
  await ensureTemplatesInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);

  const rows = await prisma.$queryRawUnsafe<TemplateRow[]>(
    `DELETE FROM ${schema}.whatsapp_templates
     WHERE id = $1::uuid
     RETURNING id, channel_id, name, display_name, language, category, body, header,
               header_type, header_example_url, footer, variables, components, buttons,
               status, meta_template_id, last_synced_at, created_at, updated_at`,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Template');
  return mapTemplateRow(rows[0]);
}

async function fetchMetaTemplates(wabaId: string, accessToken: string): Promise<MetaTemplate[]> {
  const templates: MetaTemplate[] = [];
  let after: string | null = null;

  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({
      fields: 'id,name,language,status,category,components',
      limit: '100',
    });
    if (after) params.set('after', after);

    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/message_templates?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );

    const responseText = await response.text();
    if (!response.ok) {
      throw new ValidationError(`Falha ao consultar templates na Meta: ${response.status} ${responseText.slice(0, 300)}`);
    }

    let payload: MetaTemplatesResponse;
    try {
      payload = JSON.parse(responseText) as MetaTemplatesResponse;
    } catch {
      throw new ValidationError('Resposta inválida da Meta ao listar templates');
    }

    const data = Array.isArray(payload.data) ? payload.data : [];
    templates.push(...data);

    const nextAfter = payload.paging?.cursors?.after;
    if (!nextAfter) break;
    after = nextAfter;
  }

  return templates;
}

function parseComponentText(components: MetaTemplateComponent[] | undefined, type: string): string | null {
  const component = findMetaComponent(components, type);
  const text = component?.text?.trim();
  return text ? text : null;
}

export async function syncTemplatesFromMeta(schemaName: string, channelId: string): Promise<SyncResult> {
  await ensureTemplatesInfrastructure(schemaName);

  const channel = await getChannel(schemaName, channelId);
  if (channel.type !== 'whatsapp') {
    throw new ValidationError('Sincronização com Meta disponível apenas para canais WhatsApp');
  }
  if (channel.status !== 'active') {
    throw new ValidationError('Canal deve estar ativo para sincronizar templates');
  }

  const credentials = channel.credentials ? decryptCredentials(channel.credentials) : {};
  const accessToken = String(credentials.accessToken ?? credentials.access_token ?? '').trim();
  const wabaId = String(credentials.wabaId ?? credentials.waba_id ?? '').trim();

  if (!accessToken || !wabaId) {
    throw new ValidationError('Credenciais do canal incompletas: wabaId e accessToken são obrigatórios');
  }

  const metaTemplates = await fetchMetaTemplates(wabaId, accessToken);

  const schema = quoteIdent(schemaName);
  let syncedCount = 0;

  for (const metaTemplate of metaTemplates) {
    const name = metaTemplate.name?.trim();
    if (!name) continue;

    const technicalName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
    if (!technicalName) continue;

    const language = normalizeMetaLanguage(metaTemplate.language);
    const category = normalizeMetaCategory(metaTemplate.category);
    const status = normalizeMetaStatus(metaTemplate.status);
    const headerComponent = findMetaComponent(metaTemplate.components, 'HEADER');
    const headerType = headerComponent ? normalizeHeaderType(headerComponent.format) : 'NONE';
    const headerExampleUrl = extractHeaderExampleUrl(headerComponent);
    const body = parseComponentText(metaTemplate.components, 'BODY') ?? '';
    const header = parseComponentText(metaTemplate.components, 'HEADER');
    const footer = parseComponentText(metaTemplate.components, 'FOOTER');
    const variables = extractVariablesFromBody(body);
    const components = Array.isArray(metaTemplate.components) ? metaTemplate.components : [];
    const buttons = extractButtons(metaTemplate.components);
    const displayName = normalizeDisplayName(name);

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${schema}.whatsapp_templates
        (channel_id, name, display_name, language, category, body, header, header_type,
         header_example_url, footer, variables, components, buttons, status, meta_template_id,
         last_synced_at, updated_at)
       VALUES
        ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, NOW(), NOW())
       ON CONFLICT (channel_id, name, language)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         category = EXCLUDED.category,
         body = EXCLUDED.body,
         header = EXCLUDED.header,
         header_type = EXCLUDED.header_type,
         header_example_url = EXCLUDED.header_example_url,
         footer = EXCLUDED.footer,
         variables = EXCLUDED.variables,
         components = EXCLUDED.components,
         buttons = EXCLUDED.buttons,
         status = EXCLUDED.status,
         meta_template_id = EXCLUDED.meta_template_id,
         last_synced_at = NOW(),
         updated_at = NOW()`,
      channelId,
      technicalName,
      displayName || technicalName,
      language,
      category,
      body,
      header,
      headerType,
      headerExampleUrl,
      footer,
      JSON.stringify(variables),
      JSON.stringify(components),
      JSON.stringify(buttons),
      status,
      metaTemplate.id?.trim() || null,
    );

    syncedCount += 1;
  }

  const templates = await listTemplates(schemaName, { channel_id: channelId });
  return {
    count: syncedCount,
    templates,
  };
}
