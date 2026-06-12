import { prisma } from '../../../config/database.js';
import { env } from '../../../config/env.js';
import { decryptCredentials } from '../../../utils/crypto.js';
import type {
  CreateTemplateInput,
  ListTemplatesQuery,
  TemplateButtonInput,
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

interface MetaCreateTemplateResponse {
  id?: string;
  status?: string;
  category?: string;
  error?: {
    message?: string;
    error_user_title?: string;
    error_user_msg?: string;
  };
}

export interface MetaTemplateStatusUpdate {
  templateId?: string | undefined;
  templateName?: string | undefined;
  language?: string | undefined;
  event?: string | undefined;
}

interface SyncResult {
  count: number;
  templates: TemplateRow[];
}

type InputHeaderType = CreateTemplateInput['headerType'];

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

function normalizeMetaStatus(status: string | undefined): string {
  const value = (status ?? '').trim().toUpperCase();
  if (value.includes('APPROVED')) return 'approved';
  if (value.includes('REJECTED')) return 'rejected';
  if (value.includes('DISABLED')) return 'disabled';
  if (value.includes('PAUSED')) return 'paused';
  if (value.includes('IN_APPEAL')) return 'in_appeal';
  if (value.includes('PENDING_DELETION')) return 'pending_deletion';
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

function normalizeHeaderType(format: string | null | undefined): 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' {
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

function extractHeaderHandle(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  return extractHeaderExampleUrl(
    findMetaComponent(components as MetaTemplateComponent[], 'HEADER'),
  );
}

function toStoredHeaderType(headerType: InputHeaderType): 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' {
  return headerType.toUpperCase() as 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
}

function toInputHeaderType(headerType: string | null | undefined): InputHeaderType {
  return normalizeHeaderType(headerType).toLowerCase() as InputHeaderType;
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

function validateTemplateForMeta(data: CreateTemplateInput): TemplateVariableInput[] {
  if (data.category === 'AUTHENTICATION') {
    throw new ValidationError(
      'Templates de autenticação exigem configuração específica de OTP e devem ser criados no Gerenciador do WhatsApp',
    );
  }

  if (/\{\{[^{}]+\}\}/.test(data.headerText ?? '')) {
    throw new ValidationError('O cabeçalho não pode conter variáveis neste formulário');
  }
  if (/\{\{[^{}]+\}\}/.test(data.footer ?? '')) {
    throw new ValidationError('O rodapé não pode conter variáveis');
  }

  const variables = data.variables.length > 0 ? data.variables : extractVariablesFromBody(data.body);
  const indexes = variables.map((item) => item.index);

  for (let index = 0; index < indexes.length; index += 1) {
    if (indexes[index] !== String(index + 1)) {
      throw new ValidationError('Use variáveis posicionais sequenciais no corpo: {{1}}, {{2}}, {{3}}');
    }
  }

  const missingExample = variables.find((item) => !item.example.trim());
  if (missingExample) {
    throw new ValidationError(`Informe um exemplo para a variável {{${missingExample.index}}}`);
  }

  return variables;
}

function buildMetaComponents(
  data: CreateTemplateInput,
  variables: TemplateVariableInput[],
): MetaTemplateComponent[] {
  const components: MetaTemplateComponent[] = [];
  const headerText = data.headerText?.trim();
  const headerHandle = data.headerHandle?.trim();
  const footer = data.footer?.trim();

  if (data.headerType === 'text' && headerText) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: headerText,
    });
  } else if (
    (data.headerType === 'image' || data.headerType === 'video' || data.headerType === 'document')
    && headerHandle
  ) {
    components.push({
      type: 'HEADER',
      format: toStoredHeaderType(data.headerType),
      example: {
        header_handle: [headerHandle],
      },
    });
  }

  const bodyComponent: MetaTemplateComponent & {
    example?: { body_text?: string[][] };
  } = {
    type: 'BODY',
    text: data.body,
  };
  if (variables.length > 0) {
    bodyComponent.example = {
      body_text: [variables.map((item) => item.example.trim())],
    };
  }
  components.push(bodyComponent);

  if (footer) {
    components.push({
      type: 'FOOTER',
      text: footer,
    });
  }

  if (data.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: data.buttons.map((btn) => {
        if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
          return {
            type: 'URL',
            text: btn.text,
            url: btn.url,
            example: btn.example ?? ['exemplo'],
          };
        }
        return btn;
      }),
    });
  }

  return components;
}

function getMetaCredentials(channel: ChannelRow): { accessToken: string; wabaId: string } {
  if (channel.status !== 'active') {
    throw new ValidationError('Canal deve estar ativo para gerenciar templates na Meta');
  }

  const credentials = channel.credentials ? decryptCredentials(channel.credentials) : {};
  const accessToken = String(credentials.accessToken ?? credentials.access_token ?? '').trim();
  const wabaId = String(credentials.wabaId ?? credentials.waba_id ?? '').trim();

  if (!accessToken || !wabaId) {
    throw new ValidationError('Credenciais do canal incompletas: wabaId e accessToken são obrigatórios');
  }

  return { accessToken, wabaId };
}

async function submitTemplateToMeta(
  wabaId: string,
  accessToken: string,
  data: CreateTemplateInput,
  components: MetaTemplateComponent[],
): Promise<Required<Pick<MetaCreateTemplateResponse, 'id'>> & MetaCreateTemplateResponse> {
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${wabaId}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: data.technicalName,
          language: data.language,
          category: data.category,
          allow_category_change: true,
          components,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`Não foi possível conectar à Meta: ${message}`);
  }

  const responseText = await response.text();
  let payload: MetaCreateTemplateResponse = {};
  try {
    payload = JSON.parse(responseText) as MetaCreateTemplateResponse;
  } catch {
    if (!response.ok) {
      throw new ValidationError(`Falha ao criar template na Meta: ${response.status}`);
    }
  }

  if (!response.ok) {
    const message =
      payload.error?.error_user_msg ??
      payload.error?.error_user_title ??
      payload.error?.message ??
      responseText.slice(0, 300);
    throw new ValidationError(`Meta recusou o template: ${message}`);
  }

  const id = payload.id?.trim();
  if (!id) {
    throw new ValidationError('A Meta não retornou o identificador do template criado');
  }

  return { ...payload, id };
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
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
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
    ALTER TABLE ${schema}.whatsapp_templates
      ALTER COLUMN status TYPE VARCHAR(32),
      ALTER COLUMN status SET DEFAULT 'pending'
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

  const existingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${schema}.whatsapp_templates
     WHERE channel_id = $1::uuid
       AND name = $2
       AND language = $3
     LIMIT 1`,
    data.channelId,
    data.technicalName,
    data.language,
  );
  if (existingRows[0]) {
    throw new ValidationError('Já existe template com esse nome técnico no canal e idioma selecionados');
  }

  const variables = validateTemplateForMeta(data);
  const components = buildMetaComponents(data, variables);
  const { accessToken, wabaId } = getMetaCredentials(channel);
  const metaTemplate = await submitTemplateToMeta(wabaId, accessToken, data, components);
  const status = normalizeMetaStatus(metaTemplate.status);
  const category = normalizeMetaCategory(metaTemplate.category ?? data.category);

  const rows = await prisma.$queryRawUnsafe<TemplateRow[]>(
    `INSERT INTO ${schema}.whatsapp_templates
      (channel_id, name, display_name, language, category, body, header, header_type,
       footer, variables, components, buttons, status, meta_template_id, last_synced_at)
     VALUES
      ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, NOW())
     RETURNING id, channel_id, name, display_name, language, category, body, header,
               header_type, header_example_url, footer, variables, components, buttons,
               status, meta_template_id, last_synced_at, created_at, updated_at`,
    data.channelId,
    data.technicalName,
    data.displayName,
    data.language,
    category,
    data.body,
    data.headerType === 'text' ? data.headerText?.trim() || null : null,
    toStoredHeaderType(data.headerType),
    data.footer?.trim() || null,
    JSON.stringify(variables),
    JSON.stringify(components),
    JSON.stringify(data.buttons),
    status,
    metaTemplate.id,
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

  if (current.meta_template_id) {
    const structuralFields = [
      'channelId',
      'technicalName',
      'language',
      'category',
      'body',
      'headerType',
      'headerText',
      'headerHandle',
      'footer',
      'variables',
      'buttons',
    ] as const;
    if (structuralFields.some((field) => data[field] !== undefined)) {
      throw new ValidationError(
        'Templates enviados à Meta permitem alterar apenas o nome amigável no ZiraDesk',
      );
    }
  }

  const channelId = data.channelId ?? current.channel_id;
  const technicalName = data.technicalName ?? current.name;
  const displayName = data.displayName ?? current.display_name;
  const language = normalizeMetaLanguage(data.language ?? current.language);
  let category = normalizeMetaCategory(data.category ?? current.category);
  const body = data.body ?? current.body;
  const headerType = data.headerType ?? toInputHeaderType(current.header_type);
  const headerText = data.headerText !== undefined
    ? (data.headerText.trim() || null)
    : current.header;
  const headerHandle = data.headerHandle !== undefined
    ? data.headerHandle.trim()
    : extractHeaderHandle(current.components);
  const footer = data.footer !== undefined ? (data.footer.trim() || null) : current.footer;

  const variables = data.variables
    ? data.variables
    : normalizeVariables(current.variables).length > 0
      ? normalizeVariables(current.variables)
      : extractVariablesFromBody(body);

  const buttons: TemplateButtonInput[] = data.buttons
    ?? (normalizeJsonArray(current.buttons) as TemplateButtonInput[]);

  const channel = await getChannel(schemaName, channelId);
  if (channel.type !== 'whatsapp') {
    throw new ValidationError('Templates só podem ser vinculados a canais WhatsApp');
  }

  const schema = quoteIdent(schemaName);

  if (!current.meta_template_id) {
    const submissionData: CreateTemplateInput = {
      channelId,
      technicalName,
      displayName,
      language,
      category,
      body,
      headerType,
      variables,
      buttons,
      ...(headerText ? { headerText } : {}),
      ...(headerHandle ? { headerHandle } : {}),
      ...(footer ? { footer } : {}),
    };
    const validatedVariables = validateTemplateForMeta(submissionData);
    const components = buildMetaComponents(submissionData, validatedVariables);
    const { accessToken, wabaId } = getMetaCredentials(channel);
    const metaTemplate = await submitTemplateToMeta(wabaId, accessToken, submissionData, components);
    const status = normalizeMetaStatus(metaTemplate.status);
    category = normalizeMetaCategory(metaTemplate.category ?? category);

    const submittedRows = await prisma.$queryRawUnsafe<TemplateRow[]>(
      `UPDATE ${schema}.whatsapp_templates
       SET channel_id = $1::uuid,
           name = $2,
           display_name = $3,
           language = $4,
           category = $5,
           body = $6,
           header = $7,
           header_type = $8,
           footer = $9,
           variables = $10::jsonb,
           components = $11::jsonb,
           buttons = $12::jsonb,
           status = $13,
           meta_template_id = $14,
           last_synced_at = NOW(),
           updated_at = NOW()
       WHERE id = $15::uuid
       RETURNING id, channel_id, name, display_name, language, category, body, header,
                 header_type, header_example_url, footer, variables, components, buttons,
                 status, meta_template_id, last_synced_at, created_at, updated_at`,
      channelId,
      technicalName,
      displayName,
      language,
      category,
      body,
      headerType === 'text' ? headerText : null,
      toStoredHeaderType(headerType),
      footer,
      JSON.stringify(validatedVariables),
      JSON.stringify(components),
      JSON.stringify(buttons),
      status,
      metaTemplate.id,
      id,
    );

    if (!submittedRows[0]) throw new NotFoundError('Template');
    return mapTemplateRow(submittedRows[0]);
  }

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
         updated_at = NOW()
     WHERE id = $10::uuid
     RETURNING id, channel_id, name, display_name, language, category, body, header,
               header_type, header_example_url, footer, variables, components, buttons,
               status, meta_template_id, last_synced_at, created_at, updated_at`,
    channelId,
    technicalName,
    displayName,
    language,
    category,
    body,
    current.header,
    footer,
    JSON.stringify(variables),
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

    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${wabaId}/message_templates?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(`Não foi possível conectar à Meta: ${message}`);
    }

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
  const { accessToken, wabaId } = getMetaCredentials(channel);

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

export async function updateTemplateStatusFromMeta(
  schemaName: string,
  channelId: string,
  update: MetaTemplateStatusUpdate,
): Promise<number> {
  await ensureTemplatesInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);
  const status = normalizeMetaStatus(update.event);
  const templateId = update.templateId?.trim() || null;
  const templateName = update.templateName?.trim() || null;
  const language = update.language?.trim() || null;

  if (!templateId && !templateName) return 0;

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE ${schema}.whatsapp_templates
     SET status = $1,
         meta_template_id = COALESCE($2, meta_template_id),
         last_synced_at = NOW(),
         updated_at = NOW()
     WHERE channel_id = $3::uuid
       AND (
         ($2::text IS NOT NULL AND meta_template_id = $2)
         OR (
           $4::text IS NOT NULL
           AND name = $4
           AND ($5::text IS NULL OR language = $5)
         )
       )
     RETURNING id`,
    status,
    templateId,
    channelId,
    templateName,
    language,
  );

  return rows.length;
}
