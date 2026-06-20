import { prisma } from '../../../config/database.js';
import { dispatchWebhook } from '../../../services/webhook-dispatcher.js';
import type { Server } from 'socket.io';
import type { Role } from '@ziradesk/shared';
import { decryptCredentials } from '../../../utils/crypto.js';
import type {
  ListConversationsQuery,
  ListMessagesQuery,
  SendMessageBody,
  UpdateConversationBody,
  CreateConversationBody,
  CloseConversationDto,
  ListQueueQuery,
} from './conversations.schema.js';
import {
  buildProtocolMessage,
  callGenerateProtocol,
  ensureConversationProtocolInfrastructure,
  quoteIdent,
} from './protocols.js';
import { ensureConversationTagsInfrastructure } from '../../admin/conversation-tags/conversation-tags.service.js';
import { ensureCloseConfigInfrastructure } from '../../admin/close-config/close-config.service.js';
import { ensureConversationCsatInfrastructure } from './csat.infrastructure.js';
import { ensureConversationAssignmentsInfrastructure } from './assignments.infrastructure.js';
import { calculateWaitingExpiresAt } from '../../../lib/omnichannel/calculate-waiting-expires.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class DuplicateOpenConversationError extends ConflictError {
  constructor(public readonly existingId: string) {
    super('Já existe uma conversa aberta com este contato neste canal');
    this.name = 'DuplicateOpenConversationError';
  }
}

export class WhatsappWindowExpiredError extends Error {
  constructor() {
    super('Contato fora da janela de 24h do WhatsApp');
    this.name = 'WhatsappWindowExpiredError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class TransferError extends Error {
  constructor(
    public readonly code: 'AGENT_OFFLINE' | 'NO_AGENTS_AVAILABLE_FOR_SKILL',
    message: string,
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

function validateSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new ForbiddenError('Schema do tenant inválido');
  }

  return schemaName;
}

async function withTenantSchema<T>(
  schemaName: string,
  runner: (tx: typeof prisma) => Promise<T>,
): Promise<T> {
  const safeSchemaName = validateSchemaName(schemaName);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);
    return runner(tx as typeof prisma);
  });
}

async function getSchemaName(tenantId?: string): Promise<string | null> {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  if (!tenant) throw new NotFoundError('Tenant não encontrado');
  return tenant.schemaName;
}

async function getSchemaPrefix(tenantId?: string): Promise<string> {
  const schemaName = await getSchemaName(tenantId);
  if (!schemaName) return '';
  return `${quoteIdent(schemaName)}.`;
}

function humanQueueEligibilityCondition(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}assigned_to IS NULL
           AND ${prefix}status = 'open'
           AND COALESCE(${prefix}metadata->>'bot_stage', '') <> 'waiting_choice'
           AND COALESCE(${prefix}metadata->>'ai_agent_active', 'false') <> 'true'`;
}

async function ensureConversationHelpersInfrastructure(tenantId?: string): Promise<void> {
  const schemaPrefix = await getSchemaPrefix(tenantId);
  const conversationRef = `${schemaPrefix}conversations`;
  const usersRef = `${schemaPrefix}users`;
  const helpersRef = `${schemaPrefix}conversation_helpers`;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${helpersRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES ${conversationRef}(id) ON DELETE CASCADE,
      helper_user_id UUID REFERENCES ${usersRef}(id),
      requested_by UUID REFERENCES ${usersRef}(id),
      status VARCHAR(20) DEFAULT 'requested',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      UNIQUE(conversation_id, helper_user_id)
    )
  `);
}

type ActiveCounterClient = Pick<typeof prisma, '$executeRawUnsafe'>;

async function syncActiveConversationCounters(
  db: ActiveCounterClient,
  userIds: Array<string | null | undefined>,
): Promise<void> {
  const uniqueIds = Array.from(new Set(userIds.filter((value): value is string => Boolean(value))));
  for (const userId of uniqueIds) {
    await db.$executeRawUnsafe(
      `UPDATE agent_assignments aa
       SET active_conversations = (
         SELECT COUNT(*)::integer
         FROM conversations c
         WHERE c.assigned_to = aa.user_id
           AND c.status = 'open'
       )
       WHERE aa.user_id = $1::uuid`,
      userId,
    );
  }
}

async function ensureMessagesMetadataInfrastructure(schemaName?: string | null): Promise<void> {
  const messagesRef = schemaName ? `${quoteIdent(schemaName)}.messages` : 'messages';
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ${messagesRef}
     ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  );
}

interface ConversationRow {
  id: string;
  contact_id: string | null;
  organization_id: string | null;
  channel_id: string | null;
  channel_type: string;
  conversation_type: string;
  external_id: string | null;
  status: string;
  protocol_number: string | null;
  assigned_to: string | null;
  assigned_at: Date | null;
  subject: string | null;
  last_message: string | null;
  last_message_at: Date | null;
  closed_at: Date | null;
  resolved_at: Date | null;
  csat_score: number | null;
  csat_comment: string | null;
  csat_sent_at: Date | null;
  csat_responded_at: Date | null;
  csat_stage: 'sent' | 'waiting_comment' | 'done' | null;
  closure_reason: unknown;
  waiting_expires_at: Date | null;
  queue_entered_at: Date | null;
  created_at: Date;
  metadata: unknown;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  organization_name: string | null;
  assigned_name: string | null;
  channel_name: string | null;
  bot_group?: string | null;
  bot_subject?: string | null;
  tags?: ConversationTagChip[];
}

interface ConversationTagChip {
  id: string;
  name: string;
  color: string;
}

function normalizeProtocolNumber(value: string | null | undefined): string | null {
  if (!value) return null;

  const compact = value.replace(/\s+/g, '').trim();
  if (!compact) return null;

  const upper = compact.toUpperCase();
  if (/^ZD-\d{6}-\d{6}$/.test(upper)) return upper;
  if (/^\d{6}-\d{6}$/.test(compact)) return `ZD-${compact}`;
  return compact;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  content: string;
  content_type: string;
  media_url: string | null;
  external_id: string | null;
  status: string;
  is_internal: boolean;
  created_at: Date;
  metadata: unknown;
}

interface MentionSourceMessageRow {
  id: string;
  content: string | null;
  content_type: string;
  media_url: string | null;
  external_id: string | null;
  sender_type: string;
  metadata: unknown;
  agent_name: string | null;
  contact_name: string | null;
}

interface MentionMetadata {
  message_id: string;
  sender_type: string;
  sender_label: string;
  content: string;
  content_type: string;
  external_id: string | null;
  media_id?: string | null;
  media_subtype?: string | null;
}

interface WhatsAppTemplateMetadata {
  name: string;
  language: string;
  components?: Array<Record<string, unknown>>;
}

interface MessageMetadataPatch {
  filename?: string;
  mention?: MentionMetadata;
  whatsapp_template?: WhatsAppTemplateMetadata;
}

interface MessageCursorRow {
  id: string;
  created_at: Date;
}

interface MessageCountRow {
  count: bigint;
}

interface ConversationHelperRow {
  id: string;
  conversation_id: string;
  helper_user_id: string;
  helper_name: string | null;
  requested_by: string;
  requester_name: string | null;
  status: 'requested' | 'accepted' | 'declined' | 'ended';
  created_at: Date;
  accepted_at: Date | null;
  ended_at: Date | null;
}

interface ListConversationSqlContext {
  whereSql: string;
  params: unknown[];
  limitPlaceholder: string;
  offsetPlaceholder: string;
}

function buildListConversationSqlContext(
  query: ListConversationsQuery,
  userId: string | undefined,
  searchColumn: string,
  contactColumn: string,
  tagAssignmentsRef: string,
): ListConversationSqlContext {
  const { page, perPage, tab, status, search, assigned_to_me, agent_id, contact_id, tag_id } = query;
  const offset = (page - 1) * perPage;
  const params: unknown[] = [];
  const conditions: string[] = [];

  const pushParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  switch (tab ?? status ?? 'open') {
    case 'open':
      conditions.push('c.assigned_to IS NOT NULL');
      conditions.push("c.status = 'open'");
      break;
    case 'waiting':
      conditions.push("c.status = 'waiting'");
      break;
    case 'closed':
      conditions.push("c.status = 'closed'");
      conditions.push(`c.closed_by_user_id = ${pushParam(userId ?? null)}::uuid`);
      break;
    default:
      conditions.push('c.assigned_to IS NOT NULL');
      conditions.push("c.status = 'open'");
      break;
  }

  if (assigned_to_me) {
    conditions.push(`c.assigned_to::text = ${pushParam(userId ?? null)}::text`);
  }

  if (search) {
    conditions.push(`${searchColumn} ILIKE '%' || ${pushParam(search)}::text || '%'`);
  }

  if (agent_id) {
    conditions.push(`c.assigned_to = ${pushParam(agent_id)}::uuid`);
  }

  if (contact_id) {
    conditions.push(`${contactColumn} = ${pushParam(contact_id)}::uuid`);
  }

  if (tag_id) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM ${tagAssignmentsRef} cta2
      WHERE cta2.conversation_id = c.id
        AND cta2.tag_id = ${pushParam(tag_id)}::uuid
    )`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitPlaceholder = pushParam(perPage);
  const offsetPlaceholder = pushParam(offset);

  return {
    whereSql,
    params,
    limitPlaceholder,
    offsetPlaceholder,
  };
}

interface MessagePageResult {
  messages: MessageRow[];
  has_more: boolean;
  total: number;
}

interface ConversationCounts {
  open: number;
  waiting: number;
  active: number;
  return: number;
  mine: number;
  queue: number;
  closed: number;
}

interface TenantConversationInfra {
  hasConversations: boolean;
  hasUsers: boolean;
  hasChannels: boolean;
  hasContacts: boolean;
  hasOrganizations: boolean;
  hasBotOptions: boolean;
}

function buildEmptyConversationListMeta(page: number, perPage: number) {
  return {
    total: 0,
    page,
    perPage,
    totalPages: 0,
  };
}

async function getTenantConversationInfra(schemaName?: string | null): Promise<TenantConversationInfra> {
  if (!schemaName) {
    return {
      hasConversations: true,
      hasUsers: true,
      hasChannels: true,
      hasContacts: true,
      hasOrganizations: true,
      hasBotOptions: true,
    };
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    has_conversations: boolean;
    has_users: boolean;
    has_channels: boolean;
    has_contacts: boolean;
    has_organizations: boolean;
    has_bot_options: boolean;
  }>>(
    `SELECT
       to_regclass($1::text) IS NOT NULL AS has_conversations,
       to_regclass($2::text) IS NOT NULL AS has_users,
       to_regclass($3::text) IS NOT NULL AS has_channels,
       to_regclass($4::text) IS NOT NULL AS has_contacts,
       to_regclass($5::text) IS NOT NULL AS has_organizations,
       to_regclass($6::text) IS NOT NULL AS has_bot_options`,
    `${schemaName}.conversations`,
    `${schemaName}.users`,
    `${schemaName}.channels`,
    `${schemaName}.contacts`,
    `${schemaName}.organizations`,
    `${schemaName}.bot_options`,
  );

  const row = rows[0];
  return {
    hasConversations: row?.has_conversations ?? false,
    hasUsers: row?.has_users ?? false,
    hasChannels: row?.has_channels ?? false,
    hasContacts: row?.has_contacts ?? false,
    hasOrganizations: row?.has_organizations ?? false,
    hasBotOptions: row?.has_bot_options ?? false,
  };
}

function buildMentionContentPreview(content: string | null | undefined, contentType: string): string {
  const normalized = (content ?? '').trim();
  if (normalized) return normalized.slice(0, 255);

  switch (contentType) {
    case 'image':
      return '[Imagem]';
    case 'audio':
      return '[Áudio]';
    case 'video':
      return '[Vídeo]';
    case 'document':
      return '[Documento]';
    default:
      return '[Mensagem]';
  }
}

function buildMentionSenderLabel(message: MentionSourceMessageRow): string {
  if (message.sender_type === 'agent') return message.agent_name ?? 'Agente';
  if (message.sender_type === 'bot') return 'Bot';
  if (message.sender_type === 'system') return 'Sistema';
  return message.contact_name ?? 'Cliente';
}

function getMentionMediaId(message: MentionSourceMessageRow): string | null {
  if (message.media_url?.trim()) return message.media_url.trim();
  if (!message.metadata || typeof message.metadata !== 'object') return null;
  const mediaId = (message.metadata as Record<string, unknown>).media_id;
  return typeof mediaId === 'string' && mediaId.trim() ? mediaId.trim() : null;
}

function getMentionMediaSubtype(message: MentionSourceMessageRow): string | null {
  if (!message.metadata || typeof message.metadata !== 'object') return null;
  const mediaSubtype = (message.metadata as Record<string, unknown>).media_subtype;
  return typeof mediaSubtype === 'string' && mediaSubtype.trim() ? mediaSubtype.trim() : null;
}

export async function listConversations(
  query: ListConversationsQuery,
  userId?: string,
  tenantId?: string,
  userRole?: Role,
) {
  const schemaName = await getSchemaName(tenantId);
  const infra = await getTenantConversationInfra(schemaName);
  if (
    !infra.hasConversations ||
    !infra.hasUsers ||
    !infra.hasChannels ||
    !infra.hasContacts
  ) {
    return {
      data: [],
      meta: buildEmptyConversationListMeta(query.page, query.perPage),
    };
  }

  const schemaPrefix = schemaName ? `${quoteIdent(schemaName)}.` : '';
  const conversationsRef = `${schemaPrefix}conversations`;
  const contactsRef = `${schemaPrefix}contacts`;
  const organizationsRef = `${schemaPrefix}organizations`;
  const usersRef = `${schemaPrefix}users`;
  const channelsRef = `${schemaPrefix}channels`;
  const conversationTagsRef = `${schemaPrefix}conversation_tags`;
  const conversationTagAssignmentsRef = `${schemaPrefix}conversation_tag_assignments`;
  const organizationIdSelect = infra.hasOrganizations
    ? 'COALESCE(c.organization_id, ct.organization_id) AS organization_id'
    : 'c.organization_id AS organization_id';
  const organizationNameSelect = infra.hasOrganizations
    ? 'o.name AS organization_name,'
    : 'NULL::text AS organization_name,';
  const organizationJoin = infra.hasOrganizations
    ? `LEFT JOIN ${organizationsRef} o ON o.id = COALESCE(c.organization_id, ct.organization_id)`
    : '';

  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  if (schemaName) {
    await ensureConversationTagsInfrastructure(schemaName);
  }

  const normalizedRole: string = userRole ?? '';
  const isManager = normalizedRole === 'owner' || normalizedRole === 'admin' || normalizedRole === 'supervisor';
  const effectiveQuery: ListConversationsQuery = !isManager
    && query.assigned_to_me === undefined
    && !query.agent_id
    && (query.tab === 'open' || !query.tab)
    ? { ...query, assigned_to_me: true }
    : query;

  const modernContext = buildListConversationSqlContext(
    effectiveQuery,
    userId,
    'ct.name',
    'c.contact_id',
    conversationTagAssignmentsRef,
  );

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `SELECT
       c.id, c.contact_id, ${organizationIdSelect}, c.channel_id, c.channel_type, c.conversation_type, c.external_id,
       c.status, c.protocol_number, c.assigned_to, c.assigned_at, c.subject, c.last_message, c.last_message_at,
       c.closed_at, c.resolved_at, c.csat_score, c.csat_comment, c.csat_sent_at, c.csat_responded_at, c.csat_stage,
       c.closure_reason, c.waiting_expires_at, c.queue_entered_at, c.created_at, c.metadata,
       ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone, ct.whatsapp AS contact_whatsapp,
       ${organizationNameSelect}
       u.name AS assigned_name,
       ch.name AS channel_name,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', ctag.id,
               'name', ctag.name,
               'color', ctag.color
             )
             ORDER BY ctag.sort_order ASC, ctag.name ASC
           )
           FROM ${conversationTagAssignmentsRef} cta
           JOIN ${conversationTagsRef} ctag ON ctag.id = cta.tag_id
           WHERE cta.conversation_id = c.id
             AND ctag.is_active = true
         ),
         '[]'::json
       ) AS tags
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     ${organizationJoin}
     LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
     LEFT JOIN ${channelsRef} ch ON ch.id = c.channel_id
     ${modernContext.whereSql}
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT ${modernContext.limitPlaceholder} OFFSET ${modernContext.offsetPlaceholder}`,
    ...modernContext.params,
  );

  const countParams = modernContext.params.slice(0, -2);
  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     ${modernContext.whereSql}`,
    ...countParams,
  );

  const total = Number(countRows[0]?.count ?? 0);

  return {
    data: rows,
    meta: {
      total,
      page: query.page,
      perPage: query.perPage,
      totalPages: Math.ceil(total / query.perPage),
    },
  };
}

export async function getConversationCounts(userId?: string, tenantId?: string): Promise<ConversationCounts> {
  const schemaName = await getSchemaName(tenantId);
  const infra = await getTenantConversationInfra(schemaName);
  if (!infra.hasConversations) {
    return { open: 0, waiting: 0, active: 0, return: 0, mine: 0, queue: 0, closed: 0 };
  }

  const schemaPrefix = await getSchemaPrefix(tenantId);
  const conversationRef = `${schemaPrefix}conversations`;

  const rows = await prisma.$queryRawUnsafe<Array<{
    active: bigint;
    return: bigint;
    mine: bigint;
    queue: bigint;
    closed: bigint;
  }>>(
    `SELECT
       COUNT(*) FILTER (
         WHERE assigned_to IS NOT NULL
           AND status = 'open'
       ) AS active,
       COUNT(*) FILTER (
         WHERE status = 'waiting'
       ) AS return,
       COUNT(*) FILTER (
         WHERE assigned_to::text = $1::text
           AND status = 'open'
       ) AS mine,
       COUNT(*) FILTER (
         WHERE ${humanQueueEligibilityCondition()}
       ) AS queue,
       COUNT(*) FILTER (
         WHERE status = 'closed'
           AND closed_by_user_id = $1::uuid
       ) AS closed
     FROM ${conversationRef}`,
    userId ?? null,
  );

  const counts = rows[0];
  return {
    open: Number(counts?.active ?? 0),
    waiting: Number(counts?.return ?? 0),
    active: Number(counts?.active ?? 0),
    return: Number(counts?.return ?? 0),
    mine: Number(counts?.mine ?? 0),
    queue: Number(counts?.queue ?? 0),
    closed: Number(counts?.closed ?? 0),
  };
}

export async function listQueueConversations(query: ListQueueQuery, tenantId?: string) {
  const schemaName = await getSchemaName(tenantId);
  const infra = await getTenantConversationInfra(schemaName);
  if (!infra.hasConversations || !infra.hasContacts || !infra.hasChannels) {
    return {
      data: [],
      meta: { total: 0, page: query.page, limit: query.limit, totalPages: 0 },
    };
  }

  const schemaPrefix = schemaName ? `${quoteIdent(schemaName)}.` : '';
  const conversationsRef = `${schemaPrefix}conversations`;
  const contactsRef = `${schemaPrefix}contacts`;
  const channelsRef = `${schemaPrefix}channels`;
  const usersRef = `${schemaPrefix}users`;
  const botOptionsRef = `${schemaPrefix}bot_options`;
  const offset = (query.page - 1) * query.limit;
  const params: unknown[] = [];
  const conditions = [humanQueueEligibilityCondition('c')];
  const botTopicSelect = infra.hasBotOptions
    ? `COALESCE(NULLIF(parent_bo.label, ''), NULLIF(c.metadata->>'bot_group', ''), NULLIF(c.metadata->>'bot_department', '')) AS bot_group,
       COALESCE(NULLIF(bo.label, ''), NULLIF(c.metadata->>'bot_subject', ''), NULLIF(c.metadata->>'bot_tag', ''), NULLIF(c.subject, '')) AS bot_subject,`
    : `COALESCE(NULLIF(c.metadata->>'bot_group', ''), NULLIF(c.metadata->>'bot_department', '')) AS bot_group,
       COALESCE(NULLIF(c.metadata->>'bot_subject', ''), NULLIF(c.metadata->>'bot_tag', ''), NULLIF(c.subject, '')) AS bot_subject,`;
  const botTopicJoin = infra.hasBotOptions
    ? `LEFT JOIN ${botOptionsRef} bo ON bo.id::text = c.metadata->>'bot_option_id'
       LEFT JOIN ${botOptionsRef} parent_bo ON parent_bo.id = bo.parent_option_id`
    : '';

  if (query.channel_type) {
    params.push(query.channel_type);
    conditions.push(`c.channel_type = $${params.length}::text`);
  }

  params.push(query.limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;
  const whereSql = `WHERE ${conditions.join(' AND ')}`;

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `SELECT
       c.id, c.contact_id, c.organization_id, c.channel_id, c.channel_type, c.conversation_type, c.external_id,
       c.status, c.protocol_number, c.assigned_to, c.assigned_at, c.subject, c.last_message, c.last_message_at,
       c.closed_at, c.resolved_at, c.csat_score, c.csat_comment, c.csat_sent_at, c.csat_responded_at, c.csat_stage,
       c.closure_reason, c.waiting_expires_at, c.queue_entered_at, c.created_at, c.metadata,
       ${botTopicSelect}
       ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone, ct.whatsapp AS contact_whatsapp,
       NULL::text AS organization_name,
       u.name AS assigned_name,
       ch.name AS channel_name,
       '[]'::json AS tags
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
     LEFT JOIN ${channelsRef} ch ON ch.id = c.channel_id
     ${botTopicJoin}
     ${whereSql}
     ORDER BY c.queue_entered_at ASC NULLS LAST, c.created_at ASC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    ...params,
  );

  const countParams = params.slice(0, -2);
  const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count
     FROM ${conversationsRef} c
     ${whereSql}`,
    ...countParams,
  );
  const total = Number(countRows[0]?.count ?? 0);

  return {
    data: rows,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function assignQueuedConversationToMe(
  conversationId: string,
  userId: string,
  tenantId?: string,
): Promise<{ conversation: ConversationRow }> {
  const schemaName = await getSchemaName(tenantId);
  const schemaPrefix = schemaName ? `${quoteIdent(schemaName)}.` : '';
  const previousRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${schemaPrefix}conversations
     WHERE id = $1::uuid
       AND ${humanQueueEligibilityCondition()}
     LIMIT 1`,
    conversationId,
  );

  if (!previousRows[0]) throw new ConflictError('Conversa não está disponível na fila');

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE ${schemaPrefix}conversations
     SET assigned_to = $1::uuid,
         assigned_at = NOW(),
         status = 'open',
         metadata = CASE
           WHEN queue_entered_at IS NOT NULL THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'queue_wait_started_at', queue_entered_at,
             'queue_wait_seconds', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - queue_entered_at)))::integer),
             'queue_assigned_at', NOW()
           )
           ELSE metadata
         END,
         queue_entered_at = NULL
     WHERE id = $2::uuid
       AND ${humanQueueEligibilityCondition()}
     RETURNING *`,
    userId,
    conversationId,
  );

  const conversation = rows[0];
  if (!conversation) throw new ConflictError('Conversa não está disponível na fila');

  const assignRef = `${schemaPrefix}conversation_assignments`;
  await prisma.$executeRawUnsafe(`
    UPDATE ${assignRef}
    SET released_at = NOW(), release_reason = 'auto'
    WHERE conversation_id = $1::uuid AND released_at IS NULL
  `, conversationId);
  await prisma.$executeRawUnsafe(`
    INSERT INTO ${assignRef} (conversation_id, agent_id, assigned_at)
    VALUES ($1::uuid, $2::uuid, NOW())
  `, conversationId, userId);

  await syncActiveConversationCounters(prisma, [userId]);
  return { conversation };
}

export async function getConversationWithMessages(conversationId: string, tenantId?: string) {
  const schemaName = await getSchemaName(tenantId);
  const infra = await getTenantConversationInfra(schemaName);
  if (
    !infra.hasConversations ||
    !infra.hasUsers ||
    !infra.hasChannels ||
    !infra.hasContacts
  ) {
    throw new NotFoundError('Conversa não encontrada');
  }
  const schemaPrefix = schemaName ? `${quoteIdent(schemaName)}.` : '';
  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  await ensureMessagesMetadataInfrastructure(schemaName);
  if (schemaName) {
    await ensureConversationTagsInfrastructure(schemaName);
  }
  const conversationsRef = `${schemaPrefix}conversations`;
  const contactsRef = `${schemaPrefix}contacts`;
  const organizationsRef = `${schemaPrefix}organizations`;
  const usersRef = `${schemaPrefix}users`;
  const channelsRef = `${schemaPrefix}channels`;
  const conversationTagsRef = `${schemaPrefix}conversation_tags`;
  const conversationTagAssignmentsRef = `${schemaPrefix}conversation_tag_assignments`;
  const organizationIdSelect = infra.hasOrganizations
    ? 'COALESCE(c.organization_id, ct.organization_id) AS organization_id'
    : 'c.organization_id AS organization_id';
  const organizationNameSelect = infra.hasOrganizations
    ? 'o.name AS organization_name,'
    : 'NULL::text AS organization_name,';
  const organizationJoin = infra.hasOrganizations
    ? `LEFT JOIN ${organizationsRef} o ON o.id = COALESCE(c.organization_id, ct.organization_id)`
    : '';
  let convRows: ConversationRow[] = [];
  convRows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `SELECT
       c.id, c.contact_id, ${organizationIdSelect}, c.channel_id, c.channel_type, c.conversation_type, c.external_id,
       c.status, c.protocol_number, c.assigned_to, c.assigned_at, c.subject, c.last_message, c.last_message_at,
       c.closed_at, c.resolved_at, c.csat_score, c.csat_comment, c.csat_sent_at, c.csat_responded_at, c.csat_stage,
       c.closure_reason, c.waiting_expires_at, c.queue_entered_at, c.created_at, c.metadata,
       ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone, ct.whatsapp AS contact_whatsapp,
       ${organizationNameSelect}
       u.name AS assigned_name,
       ch.name AS channel_name,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', ctag.id,
               'name', ctag.name,
               'color', ctag.color
             )
             ORDER BY ctag.sort_order ASC, ctag.name ASC
           )
           FROM ${conversationTagAssignmentsRef} cta
           JOIN ${conversationTagsRef} ctag ON ctag.id = cta.tag_id
           WHERE cta.conversation_id = c.id
             AND ctag.is_active = true
         ),
         '[]'::json
       ) AS tags
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     ${organizationJoin}
     LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
     LEFT JOIN ${channelsRef} ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );

  if (!convRows[0]) throw new NotFoundError('Conversa não encontrada');

  const messages = await prisma.$queryRawUnsafe<MessageRow[]>(
    `SELECT id, conversation_id, sender_type, sender_id, content, content_type,
            media_url, external_id, status, is_internal, created_at, metadata
     FROM ${schemaPrefix}messages
     WHERE conversation_id = $1::uuid
     ORDER BY created_at ASC`,
    conversationId,
  );

  return { conversation: convRows[0], messages };
}

export async function listConversationMessages(
  conversationId: string,
  query: ListMessagesQuery,
  tenantId?: string,
): Promise<MessagePageResult> {
  const schemaName = await getSchemaName(tenantId);
  const schemaPrefix = schemaName ? `${quoteIdent(schemaName)}.` : '';
  await ensureMessagesMetadataInfrastructure(schemaName);
  const limit = Math.max(1, query.per_page);
  const fetchLimit = limit + 1;
  let rows: MessageRow[] = [];

  if (query.before) {
    const cursorRows = await prisma.$queryRawUnsafe<MessageCursorRow[]>(
      `SELECT id, created_at
       FROM ${schemaPrefix}messages
       WHERE id = $1::uuid AND conversation_id = $2::uuid
       LIMIT 1`,
      query.before,
      conversationId,
    );
    const cursor = cursorRows[0];

    if (cursor) {
      rows = await prisma.$queryRawUnsafe<MessageRow[]>(
        `SELECT id, conversation_id, sender_type, sender_id, content, content_type,
                media_url, external_id, status, is_internal, created_at, metadata
         FROM ${schemaPrefix}messages
         WHERE conversation_id = $1::uuid
           AND (
             created_at < $2
             OR (created_at = $2 AND id < $3::uuid)
           )
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        conversationId,
        cursor.created_at,
        cursor.id,
        fetchLimit,
      );
    }
  } else {
    rows = await prisma.$queryRawUnsafe<MessageRow[]>(
      `SELECT id, conversation_id, sender_type, sender_id, content, content_type,
              media_url, external_id, status, is_internal, created_at, metadata
       FROM ${schemaPrefix}messages
       WHERE conversation_id = $1::uuid
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      conversationId,
      fetchLimit,
    );
  }

  const has_more = rows.length > limit;
  const slice = has_more ? rows.slice(0, limit) : rows;
  const messages = slice.reverse();

  const totalRows = await prisma.$queryRawUnsafe<MessageCountRow[]>(
    `SELECT COUNT(*) AS count
     FROM ${schemaPrefix}messages
     WHERE conversation_id = $1::uuid`,
    conversationId,
  );
  const total = Number(totalRows[0]?.count ?? 0);

  return { messages, has_more, total };
}

export interface SendMessageResult {
  message: MessageRow;
  channelType: string;
  channelId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  channelCredentials: string | null;
  mediaId: string | null;
  mediaType: 'image' | 'audio' | 'video' | 'document' | null;
  mediaFilename: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  templateComponents: Array<Record<string, unknown>> | null;
  replyToExternalId: string | null;
  replyToMessageId: string | null;
}

export interface MessageDispatchPayload {
  messageId: string;
  protocolNumber?: string;
  content: string;
  channelType: string;
  channelCredentials: Record<string, string> | null;
  contactPhone: string | null;
  contactEmail: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateComponents?: Array<Record<string, unknown>> | null;
}

export interface CreateConversationResult {
  conversation: ConversationRow;
  protocolDispatches: MessageDispatchPayload[];
}

interface WhatsAppTemplateLookupRow {
  id: string;
  body: string | null;
  status: string | null;
  meta_template_id: string | null;
  last_synced_at: Date | null;
}

interface WhatsAppTemplateLanguageRow {
  language: string;
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: SendMessageBody,
): Promise<SendMessageResult> {
  const convRows = await prisma.$queryRawUnsafe<
    [{
      id: string;
      channel_id: string | null;
      channel_type: string;
      status: string;
      contact_id: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      instagram_psid: string | null;
      channel_credentials: string | null;
      metadata: unknown;
    }]
  >(
    `SELECT c.id, c.channel_id, c.channel_type, c.status, c.contact_id,
            ct.phone AS contact_phone, ct.email AS contact_email,
            ct.custom_fields->>'instagram_id' AS instagram_psid,
            ch.credentials AS channel_credentials,
            c.metadata
     FROM conversations c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  if (!convRows[0]) throw new NotFoundError('Conversa não encontrada');
  const conv = convRows[0];

  const contentType =
    body.media_id && body.media_type
      ? body.media_type
      : body.contentType ?? 'text';
  const isTemplateMessage = contentType === 'template';

  const conversationMetadata = (
    conv.metadata && typeof conv.metadata === 'object'
      ? conv.metadata as Record<string, unknown>
      : null
  );
  const requiresReengagementTemplate = conversationMetadata?.whatsapp_reengagement_required === true;

  if (
    conv.channel_type === 'whatsapp'
    && !isTemplateMessage
    && requiresReengagementTemplate
  ) {
    throw new ConflictError(
      'WhatsApp fora da janela de 24h: envie um template para reengajar o contato.',
    );
  }

  const rawContent = body.content?.trim() ?? '';
  const mediaId = body.media_id ?? null;
  const mediaFilename = body.media_filename ?? null;
  const mentionMessageId = body.mention_message_id ?? null;
  const metadataPatch: MessageMetadataPatch = {};
  const templateName = isTemplateMessage ? body.whatsapp_template?.name?.trim() ?? null : null;
  const templateLanguage = isTemplateMessage
    ? body.whatsapp_template?.language?.trim() || 'pt_BR'
    : null;
  const templateComponents = isTemplateMessage
    ? body.whatsapp_template?.components ?? []
    : [];
  const normalizedTemplateComponents = templateComponents
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');

  if (isTemplateMessage && conv.channel_type === 'whatsapp' && templateName && templateLanguage) {
    const templateRows = await prisma.$queryRawUnsafe<WhatsAppTemplateLookupRow[]>(
      `SELECT id, body, status, meta_template_id, last_synced_at
       FROM whatsapp_templates
       WHERE channel_id = $1::uuid
         AND name = $2
         AND language = $3
       LIMIT 1`,
      conv.channel_id,
      templateName,
      templateLanguage,
    );

    const selectedTemplate = templateRows[0];
    if (!selectedTemplate) {
      const availableLanguageRows = await prisma.$queryRawUnsafe<WhatsAppTemplateLanguageRow[]>(
        `SELECT language
         FROM whatsapp_templates
         WHERE channel_id = $1::uuid
           AND name = $2
         ORDER BY language ASC`,
        conv.channel_id,
        templateName,
      );
      const availableLanguages = availableLanguageRows.map((row) => row.language);
      if (availableLanguages.length > 0) {
        throw new ConflictError(
          `Template "${templateName}" não existe no idioma "${templateLanguage}". Idiomas disponíveis: ${availableLanguages.join(', ')}.`,
        );
      }
      throw new ConflictError(
        `Template "${templateName}" não encontrado para este canal. Sincronize os templates com a Meta.`,
      );
    }

    const normalizedStatus = selectedTemplate.status?.trim().toLowerCase() ?? '';
    if (normalizedStatus && normalizedStatus !== 'approved') {
      throw new ConflictError(
        `Template "${templateName}" está com status "${selectedTemplate.status}". Envie apenas templates aprovados.`,
      );
    }
    if (!selectedTemplate.meta_template_id || !selectedTemplate.last_synced_at) {
      throw new ConflictError(
        `Template "${templateName}" (${templateLanguage}) não está sincronizado com a Meta para este canal. Clique em "Sincronizar com Meta" e tente novamente.`,
      );
    }
  }

  const content = isTemplateMessage
    ? (rawContent || `[Template WhatsApp: ${templateName ?? 'sem_nome'}]`)
    : rawContent;

  if (mediaFilename) {
    metadataPatch.filename = mediaFilename;
  }
  if (templateName && templateLanguage) {
    metadataPatch.whatsapp_template = {
      name: templateName,
      language: templateLanguage,
      ...(normalizedTemplateComponents.length
        ? { components: normalizedTemplateComponents }
        : {}),
    };
  }

  let replyToExternalId: string | null = null;
  let replyToMessageId: string | null = null;

  if (mentionMessageId) {
    const mentionRows = await prisma.$queryRawUnsafe<MentionSourceMessageRow[]>(
      `SELECT
         m.id,
         m.content,
         m.content_type,
         m.media_url,
         m.external_id,
         m.sender_type,
         m.metadata,
         u.name AS agent_name,
         ct.name AS contact_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE m.id = $1::uuid
         AND m.conversation_id = $2::uuid
       LIMIT 1`,
      mentionMessageId,
      conversationId,
    );
    const mentionSource = mentionRows[0];
    if (!mentionSource) throw new NotFoundError('Mensagem mencionada não encontrada');

    metadataPatch.mention = {
      message_id: mentionSource.id,
      sender_type: mentionSource.sender_type,
      sender_label: buildMentionSenderLabel(mentionSource),
      content: buildMentionContentPreview(mentionSource.content, mentionSource.content_type),
      content_type: mentionSource.content_type,
      external_id: mentionSource.external_id,
      media_id: getMentionMediaId(mentionSource),
      media_subtype: getMentionMediaSubtype(mentionSource),
    };

    replyToMessageId = mentionSource.id;
    replyToExternalId = mentionSource.external_id;
  }

  const msgRows = await prisma.$queryRawUnsafe<MessageRow[]>(
    `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, media_url, is_internal, metadata)
     VALUES ($1::uuid, 'agent', $2::uuid, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    conversationId,
    senderId,
    content,
    contentType,
    mediaId,
    body.isInternal ?? false,
    JSON.stringify(metadataPatch),
  );

  const message = msgRows[0]!;
  const mediaPreviewLabel: Record<'image' | 'audio' | 'video' | 'document' | 'template', string> = {
    image: '[Imagem]',
    audio: '[Áudio]',
    video: '[Vídeo]',
    document: '[Documento]',
    template: '[Template WhatsApp]',
  };
  const lastMessagePreview =
    content.slice(0, 255) ||
    (contentType !== 'text' ? mediaPreviewLabel[contentType as keyof typeof mediaPreviewLabel] : '[Mensagem]');

  await prisma.$executeRawUnsafe(
    `UPDATE conversations
     SET last_message = $1,
         last_message_at = NOW()
     WHERE id = $2::uuid`,
    lastMessagePreview,
    conversationId,
  );

  return {
    message,
    channelType: conv.channel_type,
    channelId: conv.channel_id,
    contactPhone: conv.channel_type === 'instagram'
      ? (conv.instagram_psid ?? null)
      : conv.contact_phone,
    contactEmail: conv.contact_email,
    channelCredentials: (body.isInternal ?? false) ? null : conv.channel_credentials,
    mediaId,
    mediaType: mediaId ? (contentType as 'image' | 'audio' | 'video' | 'document') : null,
    mediaFilename,
    templateName,
    templateLanguage,
    templateComponents: normalizedTemplateComponents.length ? normalizedTemplateComponents : null,
    replyToExternalId,
    replyToMessageId,
  };
}

export async function createConversation(
  data: CreateConversationBody,
  userId: string,
  tenantId?: string,
  actorIp?: string,
): Promise<CreateConversationResult> {
  const schemaName = await getSchemaName(tenantId);
  if (!schemaName) throw new NotFoundError('Schema do tenant não encontrado');
  await ensureConversationProtocolInfrastructure(prisma, schemaName);

  return withTenantSchema(schemaName, async (tx) => {
    const contactCheck = await tx.$queryRawUnsafe<
      [{ id: string; phone: string | null; whatsapp: string | null; email: string | null }]
    >(
      `SELECT id, phone, whatsapp, email FROM contacts WHERE id = $1::uuid LIMIT 1`,
      data.contact_id,
    );
    if (!contactCheck[0]) throw new NotFoundError('Contato não encontrado');

    const channelCheck = await tx.$queryRawUnsafe<
      [{ id: string; type: string; credentials: string | object | null }]
    >(
      `SELECT id, type, credentials FROM channels WHERE id = $1::uuid AND status = 'active' LIMIT 1`,
      data.channel_id,
    );
    if (!channelCheck[0]) throw new NotFoundError('Canal ativo não encontrado');

    const duplicateRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM conversations
       WHERE contact_id = $1::uuid
         AND channel_id = $2::uuid
         AND status = 'open'
       LIMIT 1`,
      data.contact_id,
      data.channel_id,
    );
    if (duplicateRows[0]) {
      throw new DuplicateOpenConversationError(duplicateRows[0].id);
    }

    const conversationType = data.type ?? 'inbound';
    const initialMessage = data.initial_message?.trim() ?? '';
    const initialTemplateName = data.initial_template?.name?.trim() ?? '';
    const initialTemplateLanguage = data.initial_template?.language?.trim() || 'pt_BR';
    const initialTemplateComponents = (data.initial_template?.components ?? [])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    const hasInitialTemplate = Boolean(initialTemplateName);
    const initialStatus = conversationType === 'outbound' ? 'waiting' : 'open';
    const tenantRows = tenantId
      ? await tx.$queryRawUnsafe<Array<{ settings: unknown }>>(
        `SELECT settings FROM tenants WHERE id = $1 LIMIT 1`,
        tenantId,
      )
      : [];
    const tenantSettings =
      typeof tenantRows[0]?.settings === 'object' && tenantRows[0]?.settings !== null
        ? (tenantRows[0].settings as Record<string, unknown>)
        : {};
    const tenantTimezone = typeof tenantSettings.timezone === 'string' && tenantSettings.timezone.trim()
      ? tenantSettings.timezone.trim()
      : 'America/Sao_Paulo';
    const waitingExpiresAt = conversationType === 'outbound'
      ? calculateWaitingExpiresAt(tenantSettings)
      : null;

    const metadata: Record<string, unknown> = {
      type: conversationType,
    };
    if (conversationType === 'outbound') {
      metadata.origin = 'outbound';
      metadata.outbound_started_at = new Date().toISOString();
      metadata.outbound_origin_agent_id = userId;
      metadata.outbound_timezone = tenantTimezone;
    }

    if (channelCheck[0].type === 'whatsapp' && conversationType !== 'outbound' && schemaName) {
      const lastClientMsgRows = await tx.$queryRawUnsafe<Array<{ created_at: Date }>>(
        `SELECT m.created_at
         FROM ${quoteIdent(schemaName)}.messages m
         JOIN ${quoteIdent(schemaName)}.conversations c ON c.id = m.conversation_id
         WHERE c.contact_id = $1::uuid
           AND c.channel_id = $2::uuid
           AND m.sender_type = 'client'
         ORDER BY m.created_at DESC
         LIMIT 1`,
        data.contact_id,
        data.channel_id,
      );
      const lastClientMsg = lastClientMsgRows[0];
      const withinWindow = lastClientMsg !== undefined &&
        (Date.now() - new Date(lastClientMsg.created_at).getTime()) < 24 * 60 * 60 * 1000;
      if (!withinWindow) {
        throw new WhatsappWindowExpiredError();
      }
    }

    const protocolNumber = await callGenerateProtocol(tx, schemaName);
    const convRows = await tx.$queryRawUnsafe<ConversationRow[]>(
      `INSERT INTO conversations (
         contact_id,
         organization_id,
         channel_id,
         channel_type,
         conversation_type,
         status,
         protocol_number,
         assigned_to,
         assigned_at,
         subject,
         bot_option_id,
         metadata,
         waiting_expires_at,
         queue_entered_at
       )
       VALUES (
         $1::uuid,
         $2::uuid,
         $3::uuid,
         $4,
         $5,
         $6::conversation_status,
         $7,
         $8::uuid,
         CASE WHEN $8::uuid IS NOT NULL THEN NOW() ELSE NULL END,
         $9,
         $12::uuid,
         $10::jsonb,
         $11::timestamptz,
         CASE WHEN $8::uuid IS NULL AND $6 = 'open' THEN NOW() ELSE NULL END
       )
       RETURNING *`,
      data.contact_id,
      data.organization_id ?? null,
      data.channel_id,
      channelCheck[0].type,
      conversationType,
      initialStatus,
      protocolNumber,
      userId,
      data.subject ?? null,
      JSON.stringify(metadata),
      waitingExpiresAt,
      data.bot_option_id ?? null,
    );
    const conversation = convRows[0]!;

    if (conversation.assigned_to) {
      await ensureConversationAssignmentsInfrastructure(tx, schemaName);
      const assignRef = `${quoteIdent(schemaName)}.conversation_assignments`;
      await tx.$executeRawUnsafe(`
        INSERT INTO ${assignRef} (conversation_id, agent_id, assigned_at)
        VALUES ($1::uuid, $2::uuid, NOW())
      `, conversation.id, conversation.assigned_to);
    }

    const protocolMessage = buildProtocolMessage(protocolNumber, {
      context: 'agent_initiated',
      startedAt: new Date(),
      timeZone: tenantTimezone,
    });
    const protocolMessageRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO messages (conversation_id, sender_type, content, content_type, is_internal)
       VALUES ($1::uuid, 'system', $2, 'text', false)
       RETURNING id`,
      conversation.id,
      protocolMessage,
    );
    let lastMessagePreview = protocolMessage.slice(0, 255);
    let initialMessageRows: Array<{ id: string }> = [];
    const initialAgentContent = hasInitialTemplate
      ? `[Template WhatsApp: ${initialTemplateName}]`
      : initialMessage;
    const initialAgentMetadata = hasInitialTemplate
      ? JSON.stringify({
        whatsapp_template: {
          name: initialTemplateName,
          language: initialTemplateLanguage,
          ...(initialTemplateComponents.length ? { components: initialTemplateComponents } : {}),
        },
      })
      : JSON.stringify({});

    if (initialAgentContent) {
      initialMessageRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, metadata)
         VALUES ($1::uuid, 'agent', $2::uuid, $3, $4, $5::jsonb)
         RETURNING id`,
        conversation.id,
        userId,
        initialAgentContent,
        hasInitialTemplate ? 'template' : 'text',
        initialAgentMetadata,
      );
      lastMessagePreview = initialAgentContent.slice(0, 255);
    }

    await tx.$executeRawUnsafe(
      `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2::uuid`,
      lastMessagePreview,
      conversation.id,
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data, ip_address)
       VALUES ($1::uuid, 'conversation.created', 'conversation', $2::uuid, $3::jsonb, $4::inet)`,
      userId,
      conversation.id,
      JSON.stringify({
        contact_id: data.contact_id,
        channel_id: data.channel_id,
        channel_type: channelCheck[0].type,
        conversation_type: conversationType,
        initial_message: initialAgentContent.slice(0, 100),
        created_by: userId,
      }),
      actorIp ?? null,
    );

    const protocolDispatches: MessageDispatchPayload[] = [];

    if (channelCheck[0].type === 'whatsapp') {
      const channelCredentials = channelCheck[0].credentials ? decryptCredentials(channelCheck[0].credentials) : null;
      const shouldDispatchProtocol = conversationType !== 'outbound';

      if (shouldDispatchProtocol) {
        protocolDispatches.push({
          messageId: protocolMessageRows[0]!.id,
          protocolNumber,
          content: protocolMessage,
          channelType: channelCheck[0].type,
          channelCredentials,
          contactPhone: contactCheck[0].whatsapp ?? contactCheck[0].phone,
          contactEmail: contactCheck[0].email,
        });
      }

      if (initialMessageRows[0]) {
        protocolDispatches.push({
          messageId: initialMessageRows[0].id,
          content: initialAgentContent,
          channelType: channelCheck[0].type,
          channelCredentials,
          contactPhone: contactCheck[0].whatsapp ?? contactCheck[0].phone,
          contactEmail: contactCheck[0].email,
          templateName: hasInitialTemplate ? initialTemplateName : null,
          templateLanguage: hasInitialTemplate ? initialTemplateLanguage : null,
          templateComponents: hasInitialTemplate
            ? (initialTemplateComponents.length ? initialTemplateComponents : null)
            : null,
        });
      }
    }

    if (tenantId) {
      void dispatchWebhook(tenantId, 'conversation.created', {
        conversation: { id: conversation.id, status: conversation.status, channelType: conversation.channel_type, contactId: conversation.contact_id },
      });
    }

    return { conversation, protocolDispatches };
  });
}

export async function assignConversation(
  conversationId: string,
  assignToUserId: string,
  assignedBy: string,
): Promise<{ conversation: ConversationRow; previousAssignedTo: string | null }> {
  const targetAgentRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT u.id
     FROM users u
     JOIN agent_assignments aa ON aa.user_id = u.id
     WHERE u.id = $1::uuid
       AND u.status = 'active'
       AND u.role IN ('owner', 'admin', 'supervisor', 'agent')
       AND aa.status = 'online'
     LIMIT 1`,
    assignToUserId,
  );
  if (!targetAgentRows[0]) {
    throw new ConflictError('Agente não está online para receber atendimento');
  }

  const previousRows = await prisma.$queryRawUnsafe<Array<{ id: string; assigned_to: string | null }>>(
    `SELECT id, assigned_to
     FROM conversations
     WHERE id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  const previous = previousRows[0];
  if (!previous) throw new NotFoundError('Conversa não encontrada');

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET assigned_to = $1::uuid,
         assigned_at = NOW(),
         status = 'open',
         metadata = CASE
           WHEN queue_entered_at IS NOT NULL THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'queue_wait_started_at', queue_entered_at,
             'queue_wait_seconds', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - queue_entered_at)))::integer),
             'queue_assigned_at', NOW()
           )
           ELSE metadata
         END,
         queue_entered_at = NULL,
         waiting_expires_at = NULL
     WHERE id = $2::uuid
     RETURNING *`,
    assignToUserId,
    conversationId,
  );
  if (!rows[0]) throw new NotFoundError('Conversa não encontrada');

  const agents = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM users WHERE id = $1::uuid LIMIT 1`,
    assignToUserId,
  );
  const agentName = agents[0]?.name ?? 'Agente';

  await prisma.$executeRawUnsafe(
    `INSERT INTO messages (id, conversation_id, sender_type, content, content_type, is_internal, created_at)
     VALUES (gen_random_uuid(), $1::uuid, 'system', $2, 'text', false, NOW())`,
    conversationId,
    `Atendimento assumido por ${agentName}`,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'conversation.assigned', 'conversation', $2::uuid, $3::jsonb)`,
    assignedBy,
    conversationId,
    JSON.stringify({ assigned_to: assignToUserId, status: 'open' }),
  );

  await syncActiveConversationCounters(prisma, [previous.assigned_to, assignToUserId]);

  return { conversation: rows[0]!, previousAssignedTo: previous.assigned_to };
}

export interface TransferAgentRow {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  active_conversations: number;
  is_available: boolean;
}

export interface TransferSkillRow {
  id: string;
  name: string;
  online_agents_count: number;
}

export async function listTransferAgents(currentAgentId?: string): Promise<TransferAgentRow[]> {
  const excludeClause = currentAgentId ? `AND u.id != $1::uuid` : '';
  const params: string[] = currentAgentId ? [currentAgentId] : [];

  return prisma.$queryRawUnsafe<TransferAgentRow[]>(
    `SELECT u.id, u.name, u.avatar_url, u.role,
            aa.is_available,
            COALESCE(ac.count, 0) AS active_conversations
     FROM users u
     JOIN agent_assignments aa ON aa.user_id = u.id
     LEFT JOIN (
       SELECT assigned_to, COUNT(*)::integer AS count
       FROM conversations
       WHERE status = 'open'
         AND assigned_to IS NOT NULL
       GROUP BY assigned_to
     ) ac ON ac.assigned_to = u.id
     WHERE aa.status = 'online'
       AND u.status = 'active'
       AND u.role IN ('owner', 'admin', 'supervisor', 'agent')
       ${excludeClause}
     ORDER BY aa.is_available DESC, COALESCE(ac.count, 0) ASC`,
    ...params,
  );
}

export async function listTransferSkills(): Promise<TransferSkillRow[]> {
  return prisma.$queryRawUnsafe<TransferSkillRow[]>(
    `SELECT bo.id, bo.label AS name,
            COUNT(DISTINCT aa.user_id)::integer AS online_agents_count
     FROM bot_options bo
     JOIN agent_bot_skills abs ON abs.bot_option_id = bo.id
     JOIN agent_assignments aa ON aa.user_id = abs.user_id
     WHERE aa.status = 'online'
       AND aa.is_available = true
     GROUP BY bo.id, bo.label
     HAVING COUNT(DISTINCT aa.user_id) > 0
     ORDER BY bo.label ASC`,
  );
}

export async function transferConversation(
  conversationId: string,
  target: { userId: string; skillId?: undefined } | { userId?: undefined; skillId: string },
  transferredBy: string,
  reason?: string,
  tenantId?: string,
): Promise<{ data: ConversationRow; targetUserId: string; previousAssignedTo: string | null }> {
  const schemaName = await getSchemaName(tenantId);
  const currentConversationRows = await prisma.$queryRawUnsafe<Array<{ id: string; assigned_to: string | null }>>(
    `SELECT id, assigned_to
     FROM conversations
     WHERE id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  const currentConversation = currentConversationRows[0];
  if (!currentConversation) throw new NotFoundError('Conversa não encontrada');

  const noAgentFallbackId = '00000000-0000-0000-0000-000000000000';
  const currentAgentId = currentConversation.assigned_to ?? noAgentFallbackId;
  let assignToUserId: string;

  if (target.userId) {
    const statusRows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT aa.status
       FROM agent_assignments aa
       WHERE aa.user_id = $1::uuid
       LIMIT 1`,
      target.userId,
    );

    if (!statusRows[0] || statusRows[0].status !== 'online') {
      throw new TransferError('AGENT_OFFLINE', 'Agente não está online');
    }

    assignToUserId = target.userId;
  } else {
    const eligibleAgents = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT u.id
       FROM agent_bot_skills abs
       JOIN agent_assignments aa ON aa.user_id = abs.user_id
       JOIN users u ON u.id = abs.user_id
       WHERE abs.bot_option_id = $1::uuid
         AND aa.status = 'online'
         AND aa.is_available = true
         AND u.status = 'active'
         AND u.id != $2::uuid
       ORDER BY aa.last_assigned_at ASC NULLS FIRST
       LIMIT 1`,
      target.skillId,
      currentAgentId,
    );

    if (!eligibleAgents[0]) {
      throw new TransferError('NO_AGENTS_AVAILABLE_FOR_SKILL', 'Nenhum agente disponível para este grupo');
    }

    assignToUserId = eligibleAgents[0].id;
  }

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET assigned_to = $1::uuid,
         assigned_at = NOW()
     WHERE id = $2::uuid
     RETURNING *`,
    assignToUserId,
    conversationId,
  );
  if (!rows[0]) throw new NotFoundError('Conversa não encontrada');

  const convAssignRef = schemaName
    ? `${quoteIdent(schemaName)}.conversation_assignments`
    : 'conversation_assignments';
  if (schemaName) {
    await ensureConversationAssignmentsInfrastructure(prisma, schemaName);
  }
  await prisma.$executeRawUnsafe(`
    UPDATE ${convAssignRef}
    SET released_at = NOW(), release_reason = 'transferred'
    WHERE conversation_id = $1::uuid AND released_at IS NULL
  `, conversationId);
  await prisma.$executeRawUnsafe(`
    INSERT INTO ${convAssignRef} (conversation_id, agent_id, assigned_at)
    VALUES ($1::uuid, $2::uuid, NOW())
  `, conversationId, assignToUserId);

  await prisma.$executeRawUnsafe(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'conversation.transferred', 'conversation', $2::uuid, $3::jsonb)`,
    transferredBy,
    conversationId,
    JSON.stringify({ assigned_to: assignToUserId, reason: reason ?? null }),
  );

  await syncActiveConversationCounters(prisma, [currentConversation.assigned_to, assignToUserId]);

  return {
    data: rows[0]!,
    targetUserId: assignToUserId,
    previousAssignedTo: currentConversation.assigned_to,
  };
}

export async function updateConversation(
  conversationId: string,
  body: UpdateConversationBody,
  actorUserId: string,
  tenantId?: string,
) {
  const schemaName = await getSchemaName(tenantId);
  await ensureConversationCsatInfrastructure(prisma);

  const convCheck = await prisma.$queryRawUnsafe<Array<{ id: string; assigned_to: string | null }>>(
    `SELECT id, assigned_to
     FROM conversations
     WHERE id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  if (!convCheck[0]) throw new NotFoundError('Conversa não encontrada');
  const previousAssignedTo = convCheck[0].assigned_to;

  const hasAssignedTo = 'assignedTo' in body;
  const assignedToValue = body.assignedTo ?? null;
  const hasCsatScore = 'csat_score' in body;
  const hasCsatComment = 'csat_comment' in body;

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `UPDATE conversations
     SET
       status = COALESCE($1::conversation_status, status),
       assigned_to = CASE WHEN $2 THEN $3::uuid ELSE assigned_to END,
       assigned_at = CASE WHEN $2 THEN NOW() ELSE assigned_at END,
       csat_score = CASE WHEN $5::boolean THEN $6::integer ELSE csat_score END,
       csat_comment = CASE WHEN $7::boolean THEN $8::text ELSE csat_comment END,
       resolved_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE resolved_at END,
       closed_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE closed_at END
     WHERE id = $4::uuid
     RETURNING *`,
    body.status ?? null,
    hasAssignedTo,
    assignedToValue,
    conversationId,
    hasCsatScore,
    body.csat_score ?? null,
    hasCsatComment,
    body.csat_comment ?? null,
  );

  if (hasAssignedTo) {
    const convAssignRef = schemaName
      ? `${quoteIdent(schemaName)}.conversation_assignments`
      : 'conversation_assignments';
    if (schemaName) {
      await ensureConversationAssignmentsInfrastructure(prisma, schemaName);
    }
    await prisma.$executeRawUnsafe(`
      UPDATE ${convAssignRef}
      SET released_at = NOW(), release_reason = 'reassigned'
      WHERE conversation_id = $1::uuid AND released_at IS NULL
    `, conversationId);
    if (assignedToValue !== null) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO ${convAssignRef} (conversation_id, agent_id, assigned_at)
        VALUES ($1::uuid, $2::uuid, NOW())
      `, conversationId, assignedToValue);
    }
  }

  if (body.status === 'closed') {
    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
       VALUES ($1::uuid, 'conversation.closed', 'conversation', $2::uuid, $3::jsonb)`,
      actorUserId,
      conversationId,
      JSON.stringify({
        status: 'closed',
        csat_score: body.csat_score ?? null,
        csat_comment: body.csat_comment ?? null,
      }),
    );
  }

  await syncActiveConversationCounters(prisma, [previousAssignedTo, rows[0]?.assigned_to ?? null]);

  return rows[0]!;
}

export async function closeConversation(
  conversationId: string,
  body: CloseConversationDto,
  actorUserId: string,
  actorRole: Role,
  schemaName: string,
  tenantId?: string,
): Promise<ConversationRow> {
  const safeSchemaName = validateSchemaName(schemaName);

  await ensureCloseConfigInfrastructure(safeSchemaName);
  await ensureConversationCsatInfrastructure(prisma, safeSchemaName);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);

    const conversationRows = await tx.$queryRawUnsafe<Array<{ id: string; assigned_to: string | null }>>(
      `SELECT id, assigned_to
       FROM conversations
       WHERE id = $1::uuid
       LIMIT 1`,
      conversationId,
    );

    const current = conversationRows[0];
    if (!current) throw new NotFoundError('Conversa não encontrada');
    const canClose = current.assigned_to === actorUserId || actorRole === 'admin' || actorRole === 'owner';
    if (!canClose) throw new ForbiddenError('Você não tem permissão para encerrar esta conversa');

    let closeTypeLabel: string | null = null;
    let closeOutcomeLabel: string | null = null;

    if (body.closeTypeId) {
      const typeRows = await tx.$queryRawUnsafe<Array<{ label: string }>>(
        `SELECT label
         FROM conversation_close_types
         WHERE id = $1
           AND is_active = true
         LIMIT 1`,
        body.closeTypeId,
      );

      if (!typeRows[0]) throw new ConflictError('Motivo de encerramento inválido');
      closeTypeLabel = typeRows[0].label;
    }

    if (body.closeOutcomeId) {
      const outcomeRows = await tx.$queryRawUnsafe<Array<{ label: string }>>(
        `SELECT label
         FROM conversation_close_outcomes
         WHERE id = $1
           AND is_active = true
         LIMIT 1`,
        body.closeOutcomeId,
      );

      if (!outcomeRows[0]) throw new ConflictError('Desfecho de encerramento inválido');
      closeOutcomeLabel = outcomeRows[0].label;
    }

    const closedAt = new Date();
    const closureReason = {
      reason: body.reason,
      notes: body.notes ?? null,
      closeTypeId: body.closeTypeId ?? null,
      closeTypeLabel,
      closeOutcomeId: body.closeOutcomeId ?? null,
      closeOutcomeLabel,
      [['resol', 'vedAt'].join('')]: closedAt,
      agentId: actorUserId,
    };

    const rows = await tx.$queryRawUnsafe<ConversationRow[]>(
      `UPDATE conversations
       SET status = 'closed',
           closure_reason = $1::jsonb,
           close_type_id = $2,
           close_outcome_id = $3,
           closed_at = $4,
           resolved_at = $4,
           closed_by_user_id = $6::uuid,
           waiting_expires_at = NULL,
           queue_entered_at = NULL
       WHERE id = $5::uuid
       RETURNING *`,
      JSON.stringify(closureReason),
      body.closeTypeId ?? null,
      body.closeOutcomeId ?? null,
      closedAt,
      conversationId,
      actorUserId,
    );

    const conversation = rows[0];
    if (!conversation) throw new NotFoundError('Conversa não encontrada');

    const assignRef = `${quoteIdent(safeSchemaName)}.conversation_assignments`;
    await tx.$executeRawUnsafe(`
      UPDATE ${assignRef}
      SET released_at = $1, release_reason = 'closed'
      WHERE conversation_id = $2::uuid AND released_at IS NULL
    `, closedAt, conversationId);

    await tx.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
       VALUES ($1::uuid, 'conversation.closed', 'conversation', $2::uuid, $3::jsonb)`,
      actorUserId,
      conversationId,
      JSON.stringify({
        status: 'closed',
        closure_reason: closureReason,
      }),
    );

    await syncActiveConversationCounters(tx, [conversation.assigned_to ?? current.assigned_to]);

    if (tenantId) {
      void dispatchWebhook(tenantId, 'conversation.closed', {
        conversation: { id: conversation.id, closedAt: conversation.closed_at, reason: body.reason },
      });
    }

    return conversation;
  });
}

interface ConversationCsatStateRow {
  csat_stage: string | null;
  csat_score: number | null;
  metadata: unknown;
}

export async function shouldTriggerCsatForConversation(
  conversationId: string,
  schemaName: string,
): Promise<boolean> {
  const safeSchemaName = validateSchemaName(schemaName);
  await ensureConversationCsatInfrastructure(prisma, safeSchemaName);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);

    const convStateRows = await tx.$queryRawUnsafe<ConversationCsatStateRow[]>(
      `SELECT csat_stage, csat_score, metadata
       FROM conversations
       WHERE id = $1::uuid
       LIMIT 1`,
      conversationId,
    );

    const convState = convStateRows[0];
    if (!convState) return false;

    if (convState.csat_score !== null && convState.csat_score !== undefined) return false;

    const csatStage = convState.csat_stage?.trim().toLowerCase() ?? null;
    if (csatStage === 'sent' || csatStage === 'waiting_comment' || csatStage === 'done') return false;

    return !csatStage;
  });
}

export async function requestHelp(
  conversationId: string,
  helperUserId: string,
  requesterId: string,
  tenantId: string | undefined,
  io: Server,
): Promise<ConversationHelperRow> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);
  const schemaName = await getSchemaName(tenantId);

  const conversationRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    assigned_to: string | null;
    protocol_number: string | null;
  }>>(
    `SELECT id, assigned_to, protocol_number
     FROM ${schemaPrefix}conversations
     WHERE id = $1::uuid
     LIMIT 1`,
    conversationId,
  );

  const conversation = conversationRows[0];
  if (!conversation) throw new NotFoundError('Conversa nao encontrada');
  if (!conversation.assigned_to || conversation.assigned_to !== requesterId) {
    throw new ForbiddenError('Apenas o agente responsavel pode solicitar ajuda');
  }

  if (helperUserId === requesterId) {
    throw new ConflictError('Nao e possivel solicitar ajuda para si mesmo');
  }

  const helperRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
  }>>(
    `SELECT u.id, u.name
     FROM ${schemaPrefix}users u
     JOIN ${schemaPrefix}agent_assignments aa ON aa.user_id = u.id
     WHERE u.id = $1::uuid
       AND u.status = 'active'
       AND u.role IN ('owner', 'admin', 'supervisor', 'agent')
       AND aa.status = 'online'
       AND aa.is_available = true
     LIMIT 1`,
    helperUserId,
  );

  const helper = helperRows[0];
  if (!helper) throw new ConflictError('Agente de apoio indisponivel');

  const requesterRows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT id, name
     FROM ${schemaPrefix}users
     WHERE id = $1::uuid
     LIMIT 1`,
    requesterId,
  );
  const requester = requesterRows[0];

  const rows = await prisma.$queryRawUnsafe<ConversationHelperRow[]>(
    `INSERT INTO ${schemaPrefix}conversation_helpers (
       conversation_id, helper_user_id, requested_by, status, created_at, accepted_at, ended_at
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'requested', NOW(), NULL, NULL)
     ON CONFLICT (conversation_id, helper_user_id)
     DO UPDATE SET
       requested_by = EXCLUDED.requested_by,
       status = 'requested',
       created_at = NOW(),
       accepted_at = NULL,
       ended_at = NULL
     RETURNING id, conversation_id, helper_user_id, requested_by, status, created_at, accepted_at, ended_at,
       NULL::text AS helper_name,
       NULL::text AS requester_name`,
    conversationId,
    helperUserId,
    requesterId,
  );

  const agentName = requester?.name ?? 'Agente';
  if (schemaName) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (
           user_id, action, entity, entity_id, new_data, created_at
         ) VALUES (
           $1::uuid,
           'help.requested',
           'conversation',
           $2::uuid,
           $3::jsonb,
           NOW()
         )`,
        helperUserId,
        conversationId,
        JSON.stringify({
          assigned_to: helperUserId,
          agent_name: agentName,
          conversation_id: conversationId,
        }),
      );
    });
  }

  io.to(`agent:${helperUserId}`).emit('help:requested', {
    conversationId,
    requestedBy: {
      id: requesterId,
      name: agentName,
    },
    protocol: normalizeProtocolNumber(conversation.protocol_number),
  });

  io.to(`agent:${helperUserId}`).emit('notification:new', {
    type: 'help.requested',
    title: 'Pedido de ajuda',
    message: `${agentName} precisa de ajuda`,
    conversationId,
    createdAt: new Date().toISOString(),
  });

  return rows[0]!;
}

export async function acceptHelp(
  conversationId: string,
  helperUserId: string,
  tenantId: string | undefined,
  io: Server,
): Promise<ConversationHelperRow> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  const rows = await prisma.$queryRawUnsafe<ConversationHelperRow[]>(
    `UPDATE ${schemaPrefix}conversation_helpers
     SET status = 'accepted',
         accepted_at = NOW(),
         ended_at = NULL
     WHERE conversation_id = $1::uuid
       AND helper_user_id = $2::uuid
       AND status IN ('requested', 'accepted')
     RETURNING id, conversation_id, helper_user_id, requested_by, status, created_at, accepted_at, ended_at,
       NULL::text AS helper_name,
       NULL::text AS requester_name`,
    conversationId,
    helperUserId,
  );

  const accepted = rows[0];
  if (!accepted) throw new NotFoundError('Pedido de ajuda nao encontrado');

  const detailsRows = await prisma.$queryRawUnsafe<Array<{
    helper_name: string | null;
    requester_name: string | null;
    requested_by: string;
  }>>(
    `SELECT h.requested_by, helper.name AS helper_name, requester.name AS requester_name
     FROM ${schemaPrefix}conversation_helpers h
     LEFT JOIN ${schemaPrefix}users helper ON helper.id = h.helper_user_id
     LEFT JOIN ${schemaPrefix}users requester ON requester.id = h.requested_by
     WHERE h.conversation_id = $1::uuid
       AND h.helper_user_id = $2::uuid
     LIMIT 1`,
    conversationId,
    helperUserId,
  );

  const details = detailsRows[0];
  io.to(`agent:${details?.requested_by ?? accepted.requested_by}`).emit('help:accepted', {
    conversationId,
    helper: {
      id: helperUserId,
      name: details?.helper_name ?? 'Agente',
    },
  });

  return {
    ...accepted,
    helper_name: details?.helper_name ?? null,
    requester_name: details?.requester_name ?? null,
  };
}

export async function declineHelp(
  conversationId: string,
  helperUserId: string,
  tenantId: string | undefined,
  io: Server,
): Promise<ConversationHelperRow> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  const rows = await prisma.$queryRawUnsafe<ConversationHelperRow[]>(
    `UPDATE ${schemaPrefix}conversation_helpers
     SET status = 'declined',
         ended_at = NOW()
     WHERE conversation_id = $1::uuid
       AND helper_user_id = $2::uuid
       AND status IN ('requested', 'accepted')
     RETURNING id, conversation_id, helper_user_id, requested_by, status, created_at, accepted_at, ended_at,
       NULL::text AS helper_name,
       NULL::text AS requester_name`,
    conversationId,
    helperUserId,
  );

  const declined = rows[0];
  if (!declined) throw new NotFoundError('Pedido de ajuda nao encontrado');

  io.to(`agent:${declined.requested_by}`).emit('help:declined', {
    conversationId,
    helperId: helperUserId,
  });

  return declined;
}

export async function endHelp(
  conversationId: string,
  userId: string,
  tenantId: string | undefined,
): Promise<{ updated: number }> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE ${schemaPrefix}conversation_helpers
     SET status = 'ended',
         ended_at = NOW()
     WHERE conversation_id = $1::uuid
       AND status IN ('requested', 'accepted')
       AND (helper_user_id = $2::uuid OR requested_by = $2::uuid)
     RETURNING id`,
    conversationId,
    userId,
  );

  return { updated: rows.length };
}

export async function getConversationHelpers(
  conversationId: string,
  tenantId?: string,
): Promise<ConversationHelperRow[]> {
  await ensureConversationHelpersInfrastructure(tenantId);
  const schemaPrefix = await getSchemaPrefix(tenantId);

  return prisma.$queryRawUnsafe<ConversationHelperRow[]>(
    `SELECT
       h.id,
       h.conversation_id,
       h.helper_user_id,
       helper.name AS helper_name,
       h.requested_by,
       requester.name AS requester_name,
       h.status,
       h.created_at,
       h.accepted_at,
       h.ended_at
     FROM ${schemaPrefix}conversation_helpers h
     LEFT JOIN ${schemaPrefix}users helper ON helper.id = h.helper_user_id
     LEFT JOIN ${schemaPrefix}users requester ON requester.id = h.requested_by
     WHERE h.conversation_id = $1::uuid
     ORDER BY h.created_at DESC`,
    conversationId,
  );
}
