import { prisma } from '../../../config/database.js';
import { ensureCloseConfigInfrastructure } from '../../admin/close-config/close-config.service.js';
import { ensureConversationCsatInfrastructure } from '../conversations/csat.infrastructure.js';
import { ensureConversationProtocolInfrastructure, quoteIdent } from '../conversations/protocols.js';

interface HistoryFilters {
  page: number;
  perPage: number;
  search?: string;
  status?: string;
  assignedTo?: string;
  channelType?: string;
  botOptionId?: string;
  csatRating?: '1' | '2' | '3' | '4' | '5' | 'none';
  dateFromLocal: string;
  dateToLocal: string;
  timezone: string;
}

interface HistoryRow {
  id: string;
  protocol_number: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_avatar: string | null;
  channel_type: string;
  bot_option_id: string | null;
  bot_department: string | null;
  status: string;
  duration_seconds: number | bigint | null;
  wait_seconds: number | bigint | null;
  csat_score: number | null;
  created_at: Date;
}

interface HistoryConversationDetailRow {
  id: string;
  protocol_number: string | null;
  status: string;
  channel_type: string;
  conversation_type: string;
  subject: string | null;
  close_type_id: string | null;
  close_outcome_id: string | null;
  close_type_label: string | null;
  close_outcome_label: string | null;
  created_at: Date;
  assigned_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  csat_score: number | null;
  csat_comment: string | null;
  csat_sent_at: Date | null;
  csat_responded_at: Date | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  organization_name: string | null;
  assigned_name: string | null;
  assigned_avatar: string | null;
  channel_name: string | null;
  metadata: Record<string, unknown> | null;
}

interface HistoryMessageRow {
  id: string;
  sender_type: string;
  sender_id: string | null;
  sender_name: string | null;
  content: string | null;
  content_type: string;
  media_url: string | null;
  is_internal: boolean;
  status: string;
  created_at: Date;
}

interface HistoryAuditRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  user_name: string | null;
  created_at: Date;
}

interface HistoryCsvRow {
  protocol: string;
  contact: string;
  agent: string;
  channel: string;
  group: string;
  status: string;
  duration: string;
  wait: string;
  csat: string;
  date: string;
}

const EMPTY_META = {
  total: 0,
  page: 1,
  perPage: 25,
  totalPages: 0,
};

function toSafeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }
  return schemaName;
}

async function resolveSchemaName(tenantId?: string): Promise<string | null> {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  if (!tenant) return null;
  return toSafeSchemaName(tenant.schemaName);
}

export async function resolveTenantTimezone(tenantId?: string): Promise<string> {
  if (!tenantId) return 'America/Sao_Paulo';

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  const settings =
    typeof tenant?.settings === 'object' && tenant.settings !== null
      ? (tenant.settings as Record<string, unknown>)
      : {};

  const timezone = settings.timezone;
  if (typeof timezone === 'string' && timezone.trim()) return timezone.trim();
  return 'America/Sao_Paulo';
}

function toNumber(value: number | bigint | null): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function formatDurationFromSeconds(totalSeconds: number): string {
  const normalized = Math.max(0, Math.floor(totalSeconds));
  if (normalized < 60) return `${normalized}s`;
  if (normalized < 3600) return `${Math.floor(normalized / 60)}min`;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

function channelLabel(channelType: string): string {
  const map: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    email: 'E-mail',
    webchat: 'Web Chat',
    live_chat: 'Live Chat',
    chat: 'Chat',
  };
  return map[channelType] ?? channelType;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    open: 'Aberto',
    waiting: 'Aguardando',
    closed: 'Fechado',
  };
  return map[status] ?? status;
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function serializeHistoryCsv(rows: HistoryCsvRow[]): string {
  const headers = [
    'Protocolo',
    'Contato',
    'Agente',
    'Canal',
    'Grupo/Assunto',
    'Status',
    'Duração',
    'Espera',
    'CSAT',
    'Data',
  ];

  const lines = [headers.map(csvField).join(';')];
  for (const row of rows) {
    lines.push([
      row.protocol,
      row.contact,
      row.agent,
      row.channel,
      row.group,
      row.status,
      row.duration,
      row.wait,
      row.csat,
      row.date,
    ].map(csvField).join(';'));
  }

  return lines.join('\n');
}

function buildHistoryWhereClause(filters: Omit<HistoryFilters, 'page' | 'perPage'>) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const pushParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const dateFromToken = pushParam(filters.dateFromLocal);
  const dateToToken = pushParam(filters.dateToLocal);
  const timezoneToken = pushParam(filters.timezone);

  conditions.push(`c.created_at >= ((${dateFromToken}::date)::timestamp AT TIME ZONE ${timezoneToken}::text)`);
  conditions.push(`c.created_at < ((((${dateToToken}::date + INTERVAL '1 day')::timestamp) AT TIME ZONE ${timezoneToken}::text))`);

  if (filters.search) {
    const searchToken = pushParam(filters.search);
    conditions.push(`(
      COALESCE(c.protocol_number, '') ILIKE '%' || ${searchToken}::text || '%'
      OR COALESCE(ct.name, '') ILIKE '%' || ${searchToken}::text || '%'
      OR COALESCE(ct.phone, '') ILIKE '%' || ${searchToken}::text || '%'
      OR COALESCE(ct.whatsapp, '') ILIKE '%' || ${searchToken}::text || '%'
      OR COALESCE(u.name, '') ILIKE '%' || ${searchToken}::text || '%'
    )`);
  }

  if (filters.status) {
    conditions.push(`c.status = ${pushParam(filters.status)}::text`);
  }

  if (filters.assignedTo) {
    conditions.push(`c.assigned_to = ${pushParam(filters.assignedTo)}::uuid`);
  }

  if (filters.channelType) {
    conditions.push(`c.channel_type = ${pushParam(filters.channelType)}::text`);
  }

  if (filters.botOptionId) {
    conditions.push(`c.metadata->>'bot_option_id' = ${pushParam(filters.botOptionId)}::text`);
  }

  if (filters.csatRating === 'none') {
    conditions.push('c.csat_score IS NULL');
  } else if (filters.csatRating) {
    conditions.push(`c.csat_score = ${pushParam(Number(filters.csatRating))}::integer`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return { whereSql, params };
}

export async function listHistory(filters: HistoryFilters, tenantId?: string) {
  const schemaName = await resolveSchemaName(tenantId);
  if (!schemaName) {
    return { data: [], meta: { ...EMPTY_META, page: filters.page, perPage: filters.perPage } };
  }

  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  await ensureCloseConfigInfrastructure(schemaName);

  const safeSchema = quoteIdent(schemaName);
  const conversationsRef = `${safeSchema}.conversations`;
  const contactsRef = `${safeSchema}.contacts`;
  const usersRef = `${safeSchema}.users`;

  const { whereSql, params } = buildHistoryWhereClause(filters);

  const limitToken = `$${params.length + 1}`;
  const offsetToken = `$${params.length + 2}`;

  const rows = await prisma.$queryRawUnsafe<HistoryRow[]>(
    `SELECT
       c.id,
       c.protocol_number,
       ct.name AS contact_name,
       ct.phone AS contact_phone,
       ct.whatsapp AS contact_whatsapp,
       c.assigned_to,
       u.name AS assigned_name,
       u.avatar_url AS assigned_avatar,
       c.channel_type,
       NULLIF(c.metadata->>'bot_option_id', '') AS bot_option_id,
       COALESCE(NULLIF(c.metadata->>'bot_department', ''), '—') AS bot_department,
       c.status,
       GREATEST(EXTRACT(EPOCH FROM (COALESCE(c.closed_at, c.resolved_at, c.last_message_at, NOW()) - c.created_at)), 0)::bigint AS duration_seconds,
       CASE
         WHEN c.assigned_at IS NULL THEN NULL
         ELSE GREATEST(EXTRACT(EPOCH FROM (c.assigned_at - c.created_at)), 0)::bigint
       END AS wait_seconds,
       c.csat_score,
       c.created_at
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
     ${whereSql}
     ORDER BY c.created_at DESC
     LIMIT ${limitToken}::integer OFFSET ${offsetToken}::integer`,
    ...params,
    filters.perPage,
    (filters.page - 1) * filters.perPage,
  );

  const countRows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*) AS total
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
     ${whereSql}`,
    ...params,
  );

  const total = Number(countRows[0]?.total ?? 0);

  return {
    data: rows.map((row) => ({
      ...row,
      duration_seconds: toNumber(row.duration_seconds),
      wait_seconds: row.wait_seconds === null ? null : toNumber(row.wait_seconds),
      created_at: row.created_at.toISOString(),
    })),
    meta: {
      total,
      page: filters.page,
      perPage: filters.perPage,
      totalPages: total > 0 ? Math.ceil(total / filters.perPage) : 0,
    },
  };
}

export async function getHistoryDetail(conversationId: string, tenantId?: string) {
  const schemaName = await resolveSchemaName(tenantId);
  if (!schemaName) return null;

  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  await ensureCloseConfigInfrastructure(schemaName);

  const safeSchema = quoteIdent(schemaName);
  const conversationsRef = `${safeSchema}.conversations`;
  const contactsRef = `${safeSchema}.contacts`;
  const organizationsRef = `${safeSchema}.organizations`;
  const channelsRef = `${safeSchema}.channels`;
  const usersRef = `${safeSchema}.users`;
  const messagesRef = `${safeSchema}.messages`;
  const auditLogsRef = `${safeSchema}.audit_logs`;
  const closeTypesRef = `${safeSchema}.conversation_close_types`;
  const closeOutcomesRef = `${safeSchema}.conversation_close_outcomes`;

  const detailRows = await prisma.$queryRawUnsafe<HistoryConversationDetailRow[]>(
    `SELECT
       c.id,
       c.protocol_number,
       c.status,
       c.channel_type,
       c.conversation_type,
       c.subject,
       c.close_type_id,
       c.close_outcome_id,
       ct_cfg.label AS close_type_label,
       co_cfg.label AS close_outcome_label,
       c.created_at,
       c.assigned_at,
       c.resolved_at,
       c.closed_at,
       c.csat_score,
       c.csat_comment,
       c.csat_sent_at,
       c.csat_responded_at,
       ct.name AS contact_name,
       ct.email AS contact_email,
       ct.phone AS contact_phone,
       ct.whatsapp AS contact_whatsapp,
       org.name AS organization_name,
       u.name AS assigned_name,
       u.avatar_url AS assigned_avatar,
       ch.name AS channel_name,
       c.metadata
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     LEFT JOIN ${organizationsRef} org ON org.id = c.organization_id
     LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
     LEFT JOIN ${channelsRef} ch ON ch.id = c.channel_id
     LEFT JOIN ${closeTypesRef} ct_cfg ON ct_cfg.id = c.close_type_id
     LEFT JOIN ${closeOutcomesRef} co_cfg ON co_cfg.id = c.close_outcome_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );

  const detail = detailRows[0];
  if (!detail) return null;

  const messageRows = await prisma.$queryRawUnsafe<HistoryMessageRow[]>(
    `SELECT
       m.id,
       m.sender_type,
       m.sender_id,
       CASE
         WHEN m.sender_type = 'agent' THEN au.name
         WHEN m.sender_type = 'client' THEN ct.name
         WHEN m.sender_type = 'bot' THEN 'Bot'
         ELSE 'Sistema'
       END AS sender_name,
       m.content,
       m.content_type,
       m.media_url,
       m.is_internal,
       m.status,
       m.created_at
     FROM ${messagesRef} m
     LEFT JOIN ${usersRef} au ON au.id = m.sender_id
     LEFT JOIN ${conversationsRef} c ON c.id = m.conversation_id
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     WHERE m.conversation_id = $1::uuid
     ORDER BY m.created_at ASC`,
    conversationId,
  );

  const auditRows = await prisma.$queryRawUnsafe<HistoryAuditRow[]>(
    `SELECT
       al.id,
       al.action,
       al.entity,
       al.entity_id,
       al.old_data,
       al.new_data,
       u.name AS user_name,
       al.created_at
     FROM ${auditLogsRef} al
     LEFT JOIN ${usersRef} u ON u.id = al.user_id
     WHERE al.entity = 'conversation'
       AND al.entity_id = $1::uuid
     ORDER BY al.created_at ASC`,
    conversationId,
  );

  const timeline: Array<{ id: string; type: string; title: string; description: string | null; created_at: string }> = [];
  timeline.push({
    id: `created-${detail.id}`,
    type: 'created',
    title: 'Atendimento criado',
    description: detail.protocol_number ? `Protocolo ${detail.protocol_number}` : null,
    created_at: detail.created_at.toISOString(),
  });

  if (detail.assigned_at && detail.assigned_name) {
    timeline.push({
      id: `assigned-${detail.id}`,
      type: 'assigned',
      title: 'Atendimento atribuído',
      description: `Responsável: ${detail.assigned_name}`,
      created_at: detail.assigned_at.toISOString(),
    });
  }

  for (const entry of auditRows) {
    let title = entry.action;
    let description: string | null = entry.user_name ? `Por ${entry.user_name}` : null;

    if (entry.action === 'conversation.transferred') {
      title = 'Atendimento transferido';
      const reason = typeof entry.new_data?.reason === 'string' && entry.new_data.reason.trim()
        ? entry.new_data.reason.trim()
        : null;
      description = reason
        ? `${description ?? ''}${description ? ' - ' : ''}Motivo: ${reason}`
        : description;
    } else if (entry.action === 'conversation.assigned') {
      title = 'Atendimento atribuído';
    } else if (entry.action === 'conversation.resolved') {
      title = 'Atendimento resolvido';
    } else if (entry.action === 'conversation.closed') {
      title = 'Atendimento fechado';
    } else if (entry.action === 'conversation.queue.notified') {
      title = 'Notificação de fila enviada';
      const position = entry.new_data?.position;
      description = position != null
        ? `Posição na fila: ${position}`
        : (entry.user_name ? `Por ${entry.user_name}` : null);
    } else if (entry.action === 'conversation.pii.accessed') {
      title = 'Dados do contato acessados';
      description = entry.user_name ? `Por ${entry.user_name}` : null;
    } else if (entry.action === 'conversation.created') {
      title = 'Atendimento criado';
    } else if (entry.action === 'conversation.message') {
      title = 'Mensagem recebida';
      description = typeof entry.new_data?.preview === 'string' && entry.new_data.preview.trim()
        ? entry.new_data.preview.trim()
        : description;
    } else if (entry.action === 'conversation.queue.agent_assumed') {
      title = 'Agente assumiu atendimento';
      description = typeof entry.new_data?.agent_name === 'string' && entry.new_data.agent_name.trim()
        ? `Responsável: ${entry.new_data.agent_name.trim()}`
        : description;
    } else if (entry.action === 'conversation.queue.expired_24h') {
      title = 'Fila expirada por 24h';
      description = entry.new_data?.action === 'close'
        ? 'Atendimento encerrado automaticamente'
        : description;
    } else if (entry.action === 'conversation.bot.pulled') {
      title = 'Atendimento puxado do bot';
    } else if (entry.action === 'conversation.bot.closed') {
      title = 'Atendimento encerrado pelo bot';
      const closureReason = entry.new_data?.closure_reason;
      description = closureReason
        && typeof closureReason === 'object'
        && 'notes' in closureReason
        && typeof closureReason.notes === 'string'
        && closureReason.notes.trim()
        ? closureReason.notes.trim()
        : description;
    }

    timeline.push({
      id: entry.id,
      type: entry.action,
      title,
      description,
      created_at: entry.created_at.toISOString(),
    });
  }

  if (detail.resolved_at) {
    timeline.push({
      id: `resolved-${detail.id}`,
      type: 'resolved',
      title: 'Atendimento resolvido',
      description: null,
      created_at: detail.resolved_at.toISOString(),
    });
  }

  if (detail.closed_at) {
    timeline.push({
      id: `closed-${detail.id}`,
      type: 'closed',
      title: 'Atendimento fechado',
      description: null,
      created_at: detail.closed_at.toISOString(),
    });
  }

  timeline.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return {
    conversation: {
      ...detail,
      created_at: detail.created_at.toISOString(),
      assigned_at: detail.assigned_at?.toISOString() ?? null,
      resolved_at: detail.resolved_at?.toISOString() ?? null,
      closed_at: detail.closed_at?.toISOString() ?? null,
      csat_sent_at: detail.csat_sent_at?.toISOString() ?? null,
      csat_responded_at: detail.csat_responded_at?.toISOString() ?? null,
    },
    timeline,
    transcript: messageRows.map((message) => ({
      ...message,
      created_at: message.created_at.toISOString(),
    })),
  };
}

export async function exportHistoryCsv(
  filters: Omit<HistoryFilters, 'page' | 'perPage'>,
  tenantId?: string,
): Promise<string> {
  const schemaName = await resolveSchemaName(tenantId);
  if (!schemaName) return serializeHistoryCsv([]);

  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  await ensureCloseConfigInfrastructure(schemaName);

  const safeSchema = quoteIdent(schemaName);
  const conversationsRef = `${safeSchema}.conversations`;
  const contactsRef = `${safeSchema}.contacts`;
  const usersRef = `${safeSchema}.users`;

  const { whereSql, params } = buildHistoryWhereClause(filters);

  const rows = await prisma.$queryRawUnsafe<HistoryRow[]>(
    `SELECT
       c.id,
       c.protocol_number,
       ct.name AS contact_name,
       ct.phone AS contact_phone,
       ct.whatsapp AS contact_whatsapp,
       c.assigned_to,
       u.name AS assigned_name,
       u.avatar_url AS assigned_avatar,
       c.channel_type,
       NULLIF(c.metadata->>'bot_option_id', '') AS bot_option_id,
       COALESCE(NULLIF(c.metadata->>'bot_department', ''), '—') AS bot_department,
       c.status,
       GREATEST(EXTRACT(EPOCH FROM (COALESCE(c.closed_at, c.resolved_at, c.last_message_at, NOW()) - c.created_at)), 0)::bigint AS duration_seconds,
       CASE
         WHEN c.assigned_at IS NULL THEN NULL
         ELSE GREATEST(EXTRACT(EPOCH FROM (c.assigned_at - c.created_at)), 0)::bigint
       END AS wait_seconds,
       c.csat_score,
       c.created_at
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     LEFT JOIN ${usersRef} u ON u.id = c.assigned_to
     ${whereSql}
     ORDER BY c.created_at DESC`,
    ...params,
  );

  const csvRows: HistoryCsvRow[] = rows.map((row) => ({
    protocol: row.protocol_number ?? '—',
    contact: row.contact_name ?? row.contact_whatsapp ?? row.contact_phone ?? '—',
    agent: row.assigned_name ?? '—',
    channel: channelLabel(row.channel_type),
    group: row.bot_department ?? '—',
    status: statusLabel(row.status),
    duration: formatDurationFromSeconds(toNumber(row.duration_seconds)),
    wait: row.wait_seconds === null ? '—' : formatDurationFromSeconds(toNumber(row.wait_seconds)),
    csat: row.csat_score === null ? '—' : String(row.csat_score),
    date: row.created_at.toLocaleString('pt-BR'),
  }));

  return serializeHistoryCsv(csvRows);
}
