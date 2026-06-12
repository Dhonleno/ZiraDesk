import { prisma } from '../../../config/database.js';
import type {
  ListCampaignsQuery,
  CreateCampaignBody,
  UpdateCampaignBody,
  AddContactsBody,
  DuplicateFailedCampaignBody,
} from './campaigns.schema.js';
import { ensureTemplatesInfrastructure } from '../../admin/templates/templates.service.js';
import { isPublicTestTemplate } from '../../../jobs/message-delivery-policy.js';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 422) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  channel_id: string | null;
  template_id: string | null;
  template_variables: unknown;
  template_header_media_url: string | null;
  template_header_media_filename: string | null;
  scheduled_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  total_contacts: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  daily_limit: number;
  created_by: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  created_by_name?: string | null;
  template_name?: string | null;
  channel_name?: string | null;
}

interface CampaignContactRow {
  id: string;
  campaign_id: string;
  contact_id: string;
  status: string;
  message_id: string | null;
  conversation_id: string | null;
  error_message: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  replied_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
  contact_name?: string | null;
  contact_phone?: string | null;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  status: string;
}

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  status: string;
  meta_template_id: string | null;
  body: string | null;
  header_type: string | null;
}

const MEDIA_HEADER_TYPES = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

function normalizeHeaderType(value: string | null | undefined): string {
  return (value ?? 'NONE').trim().toUpperCase() || 'NONE';
}

function normalizeMediaUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function normalizeMediaFilename(value: string | null | undefined, headerType: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed) return trimmed;
  return headerType === 'DOCUMENT' ? 'documento.pdf' : null;
}

function validateCampaignHeaderMedia(template: TemplateRow, data: CreateCampaignBody | UpdateCampaignBody): {
  mediaUrl: string | null;
  mediaFilename: string | null;
} {
  const headerType = normalizeHeaderType(template.header_type);
  const mediaUrl = normalizeMediaUrl(data.template_header_media_url);
  const mediaFilename = normalizeMediaFilename(data.template_header_media_filename, headerType);

  if (MEDIA_HEADER_TYPES.has(headerType) && !mediaUrl) {
    throw new ValidationError(`Template com header ${headerType} exige URL da mídia`);
  }

  return {
    mediaUrl: MEDIA_HEADER_TYPES.has(headerType) ? mediaUrl : null,
    mediaFilename: headerType === 'DOCUMENT' ? mediaFilename : null,
  };
}

export async function listCampaigns(
  query: ListCampaignsQuery,
  schemaName: string,
): Promise<{ data: CampaignRow[]; meta: { total: number; page: number; limit: number; total_pages: number } }> {
  const schema = quoteIdent(schemaName);
  const offset = (query.page - 1) * query.limit;
  const params: unknown[] = [];
  const pushParam = (value: unknown) => { params.push(value); return `$${params.length}`; };

  const whereClause = query.status ? `WHERE c.status = ${pushParam(query.status)}` : '';

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM ${schema}.campaigns c ${whereClause}`,
    ...params,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const limitParam = pushParam(query.limit);
  const offsetParam = pushParam(offset);

  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `SELECT
       c.id::text, c.name, c.status,
       c.channel_id::text, c.template_id::text,
       c.template_variables, c.template_header_media_url, c.template_header_media_filename,
       c.scheduled_at, c.started_at, c.completed_at,
       c.total_contacts, c.sent_count, c.delivered_count, c.read_count,
       c.replied_count, c.failed_count, c.created_by::text, c.created_at,
       u.name AS created_by_name,
       wt.name AS template_name,
       ch.name AS channel_name
     FROM ${schema}.campaigns c
     LEFT JOIN ${schema}.users u ON u.id = c.created_by
     LEFT JOIN ${schema}.channels ch ON ch.id = c.channel_id
     LEFT JOIN ${schema}.whatsapp_templates wt ON wt.id = c.template_id
     ${whereClause}
     ORDER BY c.created_at DESC
     LIMIT ${limitParam}::integer OFFSET ${offsetParam}::integer`,
    ...params,
  );

  return {
    data: rows,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      total_pages: Math.ceil(total / query.limit),
    },
  };
}

export async function getCampaignStats(schemaName: string): Promise<{
  total: number;
  running: number;
  completed: number;
  avg_delivery_rate: number;
}> {
  const schema = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<Array<{
    total: string;
    running: string;
    completed: string;
    avg_delivery_rate: string | null;
  }>>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'running')::text AS running,
       COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
       COALESCE(
         AVG(
           CASE WHEN sent_count > 0
           THEN (delivered_count::float / sent_count) * 100
           ELSE NULL END
         ) FILTER (WHERE status = 'completed'),
         0
       )::text AS avg_delivery_rate
     FROM ${schema}.campaigns`,
  );
  const row = rows[0] ?? { total: '0', running: '0', completed: '0', avg_delivery_rate: '0' };
  return {
    total: parseInt(row.total, 10),
    running: parseInt(row.running, 10),
    completed: parseInt(row.completed, 10),
    avg_delivery_rate: Math.round(parseFloat(row.avg_delivery_rate ?? '0')),
  };
}

export async function getCampaign(id: string, schemaName: string): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `SELECT
       c.*,
       c.id::text AS id, c.channel_id::text AS channel_id, c.template_id::text AS template_id,
       c.created_by::text AS created_by,
       u.name AS created_by_name,
       wt.name AS template_name,
       ch.name AS channel_name
     FROM ${schema}.campaigns c
     LEFT JOIN ${schema}.users u ON u.id = c.created_by
     LEFT JOIN ${schema}.channels ch ON ch.id = c.channel_id
     LEFT JOIN ${schema}.whatsapp_templates wt ON wt.id = c.template_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Campanha');
  return rows[0];
}

export async function createCampaign(
  data: CreateCampaignBody,
  userId: string,
  schemaName: string,
): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);

  const channelRows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id::text, type, name, status FROM ${schema}.channels WHERE id = $1::uuid LIMIT 1`,
    data.channel_id,
  );
  const channel = channelRows[0];
  if (!channel) throw new ValidationError('Canal não encontrado', 404);
  if (channel.type !== 'whatsapp') throw new ValidationError('Campanhas só são suportadas em canais WhatsApp');

  await ensureTemplatesInfrastructure(schemaName).catch(() => undefined);

  let templateRows: TemplateRow[] = [];
  try {
    templateRows = await prisma.$queryRawUnsafe<TemplateRow[]>(
      `SELECT id::text, name, language, status, meta_template_id, body, header_type
       FROM ${schema}.whatsapp_templates
       WHERE id = $1::uuid LIMIT 1`,
      data.template_id,
    );
  } catch {
    throw new ValidationError('Template não encontrado');
  }
  const template = templateRows[0];
  if (!template) throw new ValidationError('Template não encontrado');
  const normalizedStatus = template.status?.toLowerCase().trim();
  if (normalizedStatus !== 'approved') {
    throw new ValidationError(
      `Template com status "${template.status}". Envie apenas templates aprovados.`,
    );
  }
  if (!template.meta_template_id) {
    throw new ValidationError('Template não está vinculado à Meta. Sincronize os templates e tente novamente.');
  }
  if (isPublicTestTemplate(template.name)) {
    throw new ValidationError('O template hello_world é exclusivo dos números públicos de teste da Meta.');
  }
  const headerMedia = validateCampaignHeaderMedia(template, data);

  const scheduledAt = data.scheduled_at ? new Date(data.scheduled_at) : null;

  const inserted = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `INSERT INTO ${schema}.campaigns
       (name, status, channel_id, template_id, template_variables,
        template_header_media_url, template_header_media_filename,
        scheduled_at, daily_limit, created_by, notes)
     VALUES ($1, 'draft', $2::uuid, $3::uuid, $4::jsonb,
             $5, $6, $7::timestamptz, $8::integer, $9::uuid, $10)
     RETURNING *,
       id::text AS id, channel_id::text AS channel_id,
       template_id::text AS template_id, created_by::text AS created_by`,
    data.name,
    data.channel_id,
    data.template_id,
    JSON.stringify(data.template_variables),
    headerMedia.mediaUrl,
    headerMedia.mediaFilename,
    scheduledAt,
    data.daily_limit,
    userId,
    data.notes ?? null,
  );

  return inserted[0]!;
}

export async function updateCampaign(
  id: string,
  data: UpdateCampaignBody,
  schemaName: string,
): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);

  const existing = await getCampaign(id, schemaName);
  if (existing.status !== 'draft') {
    throw new ValidationError('Só é possível editar campanhas em rascunho', 409);
  }

  if (data.template_id) {
    await ensureTemplatesInfrastructure(schemaName).catch(() => undefined);
    let templateRows: TemplateRow[] = [];
    try {
      templateRows = await prisma.$queryRawUnsafe<TemplateRow[]>(
        `SELECT id::text, name, language, status, meta_template_id, body, header_type
         FROM ${schema}.whatsapp_templates
         WHERE id = $1::uuid LIMIT 1`,
        data.template_id,
      );
    } catch {
      throw new ValidationError('Template não encontrado');
    }
    const template = templateRows[0];
    if (!template) throw new ValidationError('Template não encontrado');
    const normalizedStatus = template.status?.toLowerCase().trim();
    if (normalizedStatus !== 'approved') {
      throw new ValidationError(`Template com status "${template.status}". Envie apenas templates aprovados.`);
    }
    if (!template.meta_template_id) {
      throw new ValidationError('Template não está vinculado à Meta. Sincronize os templates e tente novamente.');
    }
    if (isPublicTestTemplate(template.name)) {
      throw new ValidationError('O template hello_world é exclusivo dos números públicos de teste da Meta.');
    }
  }

  const templateForHeaderMedia = data.template_id
    ? await prisma.$queryRawUnsafe<TemplateRow[]>(
      `SELECT id::text, name, language, status, meta_template_id, body, header_type
       FROM ${schema}.whatsapp_templates
       WHERE id = $1::uuid LIMIT 1`,
      data.template_id,
    ).then((rows) => rows[0] ?? null)
    : existing.template_id
      ? await prisma.$queryRawUnsafe<TemplateRow[]>(
        `SELECT id::text, name, language, status, meta_template_id, body, header_type
         FROM ${schema}.whatsapp_templates
         WHERE id = $1::uuid LIMIT 1`,
        existing.template_id,
      ).then((rows) => rows[0] ?? null).catch(() => null)
      : null;

  const hasHeaderMediaPatch =
    'template_header_media_url' in data ||
    'template_header_media_filename' in data ||
    data.template_id !== undefined;

  const headerMedia = templateForHeaderMedia && hasHeaderMediaPatch
    ? validateCampaignHeaderMedia(templateForHeaderMedia, {
      template_header_media_url: 'template_header_media_url' in data
        ? data.template_header_media_url
        : existing.template_header_media_url,
      template_header_media_filename: 'template_header_media_filename' in data
        ? data.template_header_media_filename
        : existing.template_header_media_filename,
    } as UpdateCampaignBody)
    : null;

  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [id];
  const pushParam = (value: unknown) => { params.push(value); return `$${params.length}`; };

  if (data.name !== undefined) setClauses.push(`name = ${pushParam(data.name)}`);
  if (data.template_id !== undefined) setClauses.push(`template_id = ${pushParam(data.template_id)}::uuid`);
  if (data.template_variables !== undefined) setClauses.push(`template_variables = ${pushParam(JSON.stringify(data.template_variables))}::jsonb`);
  if (headerMedia) {
    setClauses.push(`template_header_media_url = ${pushParam(headerMedia.mediaUrl)}`);
    setClauses.push(`template_header_media_filename = ${pushParam(headerMedia.mediaFilename)}`);
  } else {
    if ('template_header_media_url' in data) setClauses.push(`template_header_media_url = ${pushParam(data.template_header_media_url ?? null)}`);
    if ('template_header_media_filename' in data) setClauses.push(`template_header_media_filename = ${pushParam(data.template_header_media_filename ?? null)}`);
  }
  if ('scheduled_at' in data) {
    const val = data.scheduled_at ? new Date(data.scheduled_at) : null;
    setClauses.push(`scheduled_at = ${pushParam(val)}::timestamptz`);
  }
  if (data.daily_limit !== undefined) setClauses.push(`daily_limit = ${pushParam(data.daily_limit)}::integer`);
  if ('notes' in data) setClauses.push(`notes = ${pushParam(data.notes ?? null)}`);

  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `UPDATE ${schema}.campaigns
     SET ${setClauses.join(', ')}
     WHERE id = $1::uuid
     RETURNING *,
       id::text AS id, channel_id::text AS channel_id,
       template_id::text AS template_id, created_by::text AS created_by`,
    ...params,
  );

  return rows[0]!;
}

export async function addContacts(
  campaignId: string,
  data: AddContactsBody,
  schemaName: string,
): Promise<{ added: number; total_contacts: number }> {
  const schema = quoteIdent(schemaName);

  const campaign = await getCampaign(campaignId, schemaName);
  if (campaign.status !== 'draft') {
    throw new ValidationError('Só é possível adicionar contatos a campanhas em rascunho', 409);
  }

  let addedCount = 0;
  for (const contactId of data.contact_ids) {
    const contactRows = await prisma.$queryRawUnsafe<Array<{ id: string; phone: string | null; whatsapp: string | null }>>(
      `SELECT id::text, phone, whatsapp FROM ${schema}.contacts WHERE id = $1::uuid LIMIT 1`,
      contactId,
    );
    const contact = contactRows[0];
    if (!contact) continue;

    const hasPhone = Boolean(contact.whatsapp?.trim() || contact.phone?.trim());
    if (!hasPhone) {
      throw new ValidationError(
        `Contato ${contactId} não possui WhatsApp ou telefone cadastrado`,
      );
    }

    const upserted = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO ${schema}.campaign_contacts (campaign_id, contact_id)
       VALUES ($1::uuid, $2::uuid)
       ON CONFLICT (campaign_id, contact_id) DO NOTHING
       RETURNING id`,
      campaignId,
      contactId,
    );
    if (upserted[0]) addedCount++;
  }

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM ${schema}.campaign_contacts WHERE campaign_id = $1::uuid`,
    campaignId,
  );
  const totalContacts = parseInt(countRows[0]?.count ?? '0', 10);

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.campaigns SET total_contacts = $1::integer, updated_at = NOW() WHERE id = $2::uuid`,
    totalContacts,
    campaignId,
  );

  return { added: addedCount, total_contacts: totalContacts };
}

export async function removeContact(
  campaignId: string,
  contactId: string,
  schemaName: string,
): Promise<void> {
  const schema = quoteIdent(schemaName);

  const campaign = await getCampaign(campaignId, schemaName);
  if (campaign.status !== 'draft') {
    throw new ValidationError('Só é possível remover contatos de campanhas em rascunho', 409);
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM ${schema}.campaign_contacts WHERE campaign_id = $1::uuid AND contact_id = $2::uuid`,
    campaignId,
    contactId,
  );

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM ${schema}.campaign_contacts WHERE campaign_id = $1::uuid`,
    campaignId,
  );
  const totalContacts = parseInt(countRows[0]?.count ?? '0', 10);
  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.campaigns SET total_contacts = $1::integer, updated_at = NOW() WHERE id = $2::uuid`,
    totalContacts,
    campaignId,
  );
}

export async function listCampaignContacts(
  campaignId: string,
  schemaName: string,
  page = 1,
  limit = 50,
): Promise<{ data: CampaignContactRow[]; meta: { total: number; page: number; limit: number } }> {
  const schema = quoteIdent(schemaName);

  await getCampaign(campaignId, schemaName);

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM ${schema}.campaign_contacts WHERE campaign_id = $1::uuid`,
    campaignId,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);
  const offset = (page - 1) * limit;

  const rows = await prisma.$queryRawUnsafe<CampaignContactRow[]>(
    `SELECT
       cc.id::text, cc.campaign_id::text, cc.contact_id::text,
       cc.status, cc.message_id, cc.conversation_id::text,
       cc.error_message, cc.sent_at, cc.delivered_at,
       cc.read_at, cc.replied_at, cc.failed_at, cc.created_at,
       c.name AS contact_name,
       COALESCE(c.whatsapp, c.phone) AS contact_phone
     FROM ${schema}.campaign_contacts cc
     JOIN ${schema}.contacts c ON c.id = cc.contact_id
     WHERE cc.campaign_id = $1::uuid
     ORDER BY cc.created_at ASC
     LIMIT $2::integer OFFSET $3::integer`,
    campaignId,
    limit,
    offset,
  );

  return { data: rows, meta: { total, page, limit } };
}

export async function launchCampaign(
  campaignId: string,
  userId: string,
  schemaName: string,
): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);
  const campaign = await getCampaign(campaignId, schemaName);

  if (campaign.status !== 'draft') {
    throw new ValidationError('Só é possível iniciar campanhas em rascunho', 409);
  }
  if (!campaign.template_id) throw new ValidationError('Campanha sem template definido');
  if (!campaign.channel_id) throw new ValidationError('Campanha sem canal definido');
  if (campaign.total_contacts === 0) {
    throw new ValidationError('Campanha sem contatos. Adicione ao menos 1 contato antes de iniciar');
  }

  const templateRows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM ${schema}.whatsapp_templates WHERE id = $1::uuid LIMIT 1`,
    campaign.template_id,
  );
  if (isPublicTestTemplate(templateRows[0]?.name)) {
    throw new ValidationError('O template hello_world é exclusivo dos números públicos de teste da Meta.');
  }

  const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at) : null;
  const now = new Date();
  const isScheduled = scheduledAt && scheduledAt > now;
  const newStatus = isScheduled ? 'scheduled' : 'running';

  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `UPDATE ${schema}.campaigns
     SET status = $1, started_at = CASE WHEN $1 = 'running' THEN NOW() ELSE NULL END, updated_at = NOW()
     WHERE id = $2::uuid
     RETURNING *, id::text AS id, channel_id::text AS channel_id,
       template_id::text AS template_id, created_by::text AS created_by`,
    newStatus,
    campaignId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'campaign.launched', 'campaign', $2::uuid, $3::jsonb)`,
    userId,
    campaignId,
    JSON.stringify({ status: newStatus, scheduled_at: campaign.scheduled_at }),
  );

  return rows[0]!;
}

export async function pauseCampaign(
  campaignId: string,
  userId: string,
  schemaName: string,
): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);
  const campaign = await getCampaign(campaignId, schemaName);

  if (campaign.status !== 'running') {
    throw new ValidationError('Só é possível pausar campanhas em execução', 409);
  }

  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `UPDATE ${schema}.campaigns
     SET status = 'paused', updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *, id::text AS id, channel_id::text AS channel_id,
       template_id::text AS template_id, created_by::text AS created_by`,
    campaignId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'campaign.paused', 'campaign', $2::uuid, $3::jsonb)`,
    userId,
    campaignId,
    JSON.stringify({ previous_status: 'running' }),
  );

  return rows[0]!;
}

export async function resumeCampaign(
  campaignId: string,
  userId: string,
  schemaName: string,
): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);
  const campaign = await getCampaign(campaignId, schemaName);

  if (campaign.status !== 'paused') {
    throw new ValidationError('Só é possível retomar campanhas pausadas', 409);
  }

  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `UPDATE ${schema}.campaigns
     SET status = 'running', updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *, id::text AS id, channel_id::text AS channel_id,
       template_id::text AS template_id, created_by::text AS created_by`,
    campaignId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'campaign.resumed', 'campaign', $2::uuid, $3::jsonb)`,
    userId,
    campaignId,
    JSON.stringify({ previous_status: 'paused' }),
  );

  return rows[0]!;
}

export async function cancelCampaign(
  campaignId: string,
  userId: string,
  schemaName: string,
): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);
  const campaign = await getCampaign(campaignId, schemaName);

  const cancellableStatuses = ['draft', 'scheduled', 'running', 'paused'];
  if (!cancellableStatuses.includes(campaign.status)) {
    throw new ValidationError('Campanha não pode ser cancelada no status atual', 409);
  }

  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `UPDATE ${schema}.campaigns
     SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *, id::text AS id, channel_id::text AS channel_id,
       template_id::text AS template_id, created_by::text AS created_by`,
    campaignId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'campaign.cancelled', 'campaign', $2::uuid, $3::jsonb)`,
    userId,
    campaignId,
    JSON.stringify({ previous_status: campaign.status }),
  );

  return rows[0]!;
}

export async function duplicateCampaign(
  campaignId: string,
  userId: string,
  schemaName: string,
): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);
  const original = await getCampaign(campaignId, schemaName);

  const inserted = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `INSERT INTO ${schema}.campaigns
     (name, status, channel_id, template_id, template_variables,
        template_header_media_url, template_header_media_filename,
        daily_limit, created_by, notes)
     VALUES ($1, 'draft', $2::uuid, $3::uuid, $4::jsonb, $5, $6, $7::integer, $8::uuid, $9)
     RETURNING *, id::text AS id, channel_id::text AS channel_id,
       template_id::text AS template_id, created_by::text AS created_by`,
    `${original.name} (cópia)`,
    original.channel_id,
    original.template_id,
    JSON.stringify(original.template_variables ?? {}),
    original.template_header_media_url,
    original.template_header_media_filename,
    original.daily_limit,
    userId,
    original.notes ?? null,
  );

  const newCampaign = inserted[0]!;

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.campaign_contacts (campaign_id, contact_id)
     SELECT $1::uuid, contact_id
     FROM ${schema}.campaign_contacts
     WHERE campaign_id = $2::uuid`,
    newCampaign.id,
    campaignId,
  );

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM ${schema}.campaign_contacts WHERE campaign_id = $1::uuid`,
    newCampaign.id,
  );
  const totalContacts = parseInt(countRows[0]?.count ?? '0', 10);

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.campaigns SET total_contacts = $1::integer WHERE id = $2::uuid`,
    totalContacts,
    newCampaign.id,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'campaign.duplicated', 'campaign', $2::uuid, $3::jsonb)`,
    userId,
    newCampaign.id,
    JSON.stringify({ original_campaign_id: campaignId }),
  );

  return { ...newCampaign, total_contacts: totalContacts };
}

export async function duplicateFailedCampaign(
  campaignId: string,
  data: DuplicateFailedCampaignBody,
  userId: string,
  schemaName: string,
): Promise<CampaignRow> {
  const schema = quoteIdent(schemaName);
  const original = await getCampaign(campaignId, schemaName);
  if (!original.channel_id) {
    throw new ValidationError('A campanha original não possui um canal válido', 409);
  }

  const failedCountRows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count
     FROM ${schema}.campaign_contacts
     WHERE campaign_id = $1::uuid
       AND status = 'failed'`,
    campaignId,
  );
  const failedContacts = parseInt(failedCountRows[0]?.count ?? '0', 10);
  if (failedContacts === 0) {
    throw new ValidationError('A campanha não possui contatos com falha', 409);
  }

  const newCampaign = await createCampaign({
    ...data,
    channel_id: original.channel_id,
  }, userId, schemaName);

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.campaign_contacts (campaign_id, contact_id)
     SELECT $1::uuid, contact_id
     FROM ${schema}.campaign_contacts
     WHERE campaign_id = $2::uuid
       AND status = 'failed'`,
    newCampaign.id,
    campaignId,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.campaigns
     SET total_contacts = $1::integer
     WHERE id = $2::uuid`,
    failedContacts,
    newCampaign.id,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'campaign.duplicated_failed', 'campaign', $2::uuid, $3::jsonb)`,
    userId,
    newCampaign.id,
    JSON.stringify({ original_campaign_id: campaignId, failed_contacts: failedContacts }),
  );

  return { ...newCampaign, total_contacts: failedContacts };
}

export async function getCampaignReport(
  campaignId: string,
  schemaName: string,
): Promise<{
  campaign: CampaignRow;
  breakdown: Array<{ date: string; sent: number; delivered: number; read: number; replied: number; failed: number }>;
}> {
  const schema = quoteIdent(schemaName);
  const campaign = await getCampaign(campaignId, schemaName);

  const breakdown = await prisma.$queryRawUnsafe<Array<{
    date: string;
    sent: string;
    delivered: string;
    read: string;
    replied: string;
    failed: string;
  }>>(
    `SELECT
       DATE(COALESCE(sent_at, failed_at, created_at) AT TIME ZONE 'UTC')::text AS date,
       COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::text AS sent,
       COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))::text AS delivered,
       COUNT(*) FILTER (WHERE status IN ('read','replied'))::text AS read,
       COUNT(*) FILTER (WHERE status = 'replied')::text AS replied,
       COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
     FROM ${schema}.campaign_contacts
     WHERE campaign_id = $1::uuid
       AND (sent_at IS NOT NULL OR failed_at IS NOT NULL)
      GROUP BY DATE(COALESCE(sent_at, failed_at, created_at) AT TIME ZONE 'UTC')
      ORDER BY DATE(COALESCE(sent_at, failed_at, created_at) AT TIME ZONE 'UTC') ASC`,
    campaignId,
  );

  return {
    campaign,
    breakdown: breakdown.map((row) => ({
      date: row.date,
      sent: parseInt(row.sent ?? '0', 10),
      delivered: parseInt(row.delivered ?? '0', 10),
      read: parseInt(row.read ?? '0', 10),
      replied: parseInt(row.replied ?? '0', 10),
      failed: parseInt(row.failed ?? '0', 10),
    })),
  };
}

export async function handleCampaignOptOut(
  schemaName: string,
  _conversationId: string,
  contactId: string,
  campaignId: string,
  phone: string,
): Promise<void> {
  const schema = quoteIdent(schemaName);

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.campaign_contacts
     SET status = 'opted_out'
     WHERE campaign_id = $1::uuid AND contact_id = $2::uuid AND status != 'opted_out'`,
    campaignId,
    contactId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.campaign_optouts (contact_id, phone, campaign_id)
     VALUES ($1::uuid, $2, $3::uuid)
     ON CONFLICT (contact_id) DO UPDATE SET opted_out_at = NOW(), campaign_id = EXCLUDED.campaign_id`,
    contactId,
    phone,
    campaignId,
  );
}
