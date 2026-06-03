import { prisma } from '../../config/database.js';
import {
  ensureAgentAssignmentsInfrastructure,
  ensureAgentBotSkillsInfrastructure,
} from './conversations/auto-assign.service.js';
import { ensureConversationProtocolInfrastructure, quoteIdent } from './conversations/protocols.js';

interface MonitorAgent {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  status: 'online' | 'paused' | 'offline' | string;
  is_available: boolean;
  pause_reason: string | null;
  pause_started_at: string | null;
  active_conversations: number;
  max_conversations: number | null;
  skills: Array<{
    id: string;
    bot_option_id: string;
    label: string;
    name: string;
    tag: string | null;
    parent_label: string | null;
    level: 'junior' | 'intermediate' | 'senior';
  }>;
}

interface MonitorResponse {
  agents: MonitorAgent[];
  queue: {
    total: number;
    by_department: Record<string, number>;
  };
  active: {
    total: number;
    by_agent: Record<string, number>;
  };
  stats_today: {
    total_resolved: number;
    avg_resolution_minutes: number;
    total_messages: number;
  };
}

export interface MonitorBotConversation {
  id: string;
  protocol_number: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
  last_message: string | null;
  last_message_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  channel_name: string | null;
  channel_type: string;
  minutes_in_bot: number;
}

export interface MonitorBotResponse {
  conversations: MonitorBotConversation[];
  total: number;
  stuck: number;
}

export class MonitorBotNotFoundError extends Error {}
export class MonitorBotInvalidStateError extends Error {}
export class MonitorBotConflictError extends Error {}

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function botEligibilityCondition(alias: string): string {
  return `${alias}.status = 'open'
    AND ${alias}.assigned_to IS NULL
    AND ${alias}.queue_entered_at IS NULL
    AND ${alias}.metadata->>'bot_stage' = 'waiting_choice'`;
}

export async function getMonitorSnapshot(schemaName: string): Promise<MonitorResponse> {
  await ensureAgentAssignmentsInfrastructure(prisma, schemaName);
  await ensureAgentBotSkillsInfrastructure(prisma, schemaName);
  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  const usersRef = tableRef(schemaName, 'users');
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const agentBotSkillsRef = tableRef(schemaName, 'agent_bot_skills');
  const botOptionsRef = tableRef(schemaName, 'bot_options');
  const conversationsRef = tableRef(schemaName, 'conversations');
  const messagesRef = tableRef(schemaName, 'messages');

  const [agents, queueRows, activeRows, statsRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      avatar_url: string | null;
      role: string;
      status: string;
      is_available: boolean;
      pause_reason: string | null;
      pause_started_at: Date | null;
      active_conversations: number;
      max_conversations: number | null;
      skills: MonitorAgent['skills'];
    }>>(
      `SELECT
         u.id,
         u.name,
         u.avatar_url,
         u.role,
         COALESCE(aa.status, 'offline') AS status,
         COALESCE(aa.is_available, false) AS is_available,
         aa.pause_reason,
         aa.pause_started_at,
         aa.max_conversations,
         COALESCE(
           (
             SELECT COUNT(*)::integer
             FROM ${conversationsRef} c_active
             WHERE c_active.assigned_to = u.id
               AND c_active.status = 'open'
           ),
           0
         ) AS active_conversations,
         COALESCE(
           json_agg(
             json_build_object(
               'id', bo.id,
               'bot_option_id', bo.id,
               'label', bo.label,
               'name', bo.label,
               'tag', bo.tag,
               'parent_label', parent.label,
               'level', abs.level
             )
           ) FILTER (WHERE bo.id IS NOT NULL),
           '[]'::json
         ) AS skills
       FROM ${usersRef} u
       LEFT JOIN ${assignmentsRef} aa ON aa.user_id = u.id
       LEFT JOIN ${agentBotSkillsRef} abs ON abs.user_id = u.id
       LEFT JOIN ${botOptionsRef} bo ON bo.id = abs.bot_option_id
       LEFT JOIN ${botOptionsRef} parent ON parent.id = bo.parent_option_id
       WHERE u.status = 'active'
         AND u.role = 'agent'
       GROUP BY
         u.id,
         u.name,
         u.avatar_url,
         u.role,
         aa.status,
         aa.is_available,
         aa.pause_reason,
         aa.pause_started_at,
         aa.max_conversations
       ORDER BY u.name ASC`,
    ),
    prisma.$queryRawUnsafe<Array<{ tag: string | null; total: bigint }>>(
      `SELECT
         NULLIF(TRIM(COALESCE(metadata->>'bot_tag', '')), '') AS tag,
         COUNT(*) AS total
       FROM ${conversationsRef}
       WHERE assigned_to IS NULL
         AND status = 'open'
         AND queue_entered_at IS NOT NULL
        GROUP BY tag`,
    ),
    prisma.$queryRawUnsafe<Array<{ agent_id: string; total: bigint }>>(
      `SELECT assigned_to::text AS agent_id, COUNT(*) AS total
       FROM ${conversationsRef}
       WHERE assigned_to IS NOT NULL
         AND status = 'open'
       GROUP BY assigned_to`,
    ),
    prisma.$queryRawUnsafe<Array<{
      total_resolved: bigint;
      avg_resolution_minutes: number | null;
      total_messages: bigint;
    }>>(
      `SELECT
         (
           SELECT COUNT(*)
           FROM ${conversationsRef} c
           WHERE c.resolved_at IS NOT NULL
             AND c.resolved_at::date = CURRENT_DATE
         ) AS total_resolved,
         (
           SELECT AVG(EXTRACT(EPOCH FROM (
             c.resolved_at - COALESCE(
               CASE
                 WHEN c.conversation_type = 'outbound' THEN c.outbound_returned_at
                 ELSE NULL
               END,
               c.created_at
             )
           )) / 60.0)
           FROM ${conversationsRef} c
           WHERE c.resolved_at IS NOT NULL
             AND c.resolved_at::date = CURRENT_DATE
         ) AS avg_resolution_minutes,
         (
           SELECT COUNT(*)
           FROM ${messagesRef} m
           WHERE m.created_at::date = CURRENT_DATE
         ) AS total_messages`,
    ),
  ]);

  const queueByDepartment: Record<string, number> = {};
  let queueTotal = 0;
  for (const row of queueRows) {
    const key = row.tag ?? 'geral';
    const value = Number(row.total ?? 0);
    queueByDepartment[key] = value;
    queueTotal += value;
  }

  const activeByAgent: Record<string, number> = {};
  let activeTotal = 0;
  for (const row of activeRows) {
    const value = Number(row.total ?? 0);
    activeByAgent[row.agent_id] = value;
    activeTotal += value;
  }

  const stats = statsRows[0];

  return {
    agents: agents.map((agent) => ({
      ...agent,
      pause_started_at: agent.pause_started_at ? agent.pause_started_at.toISOString() : null,
    })),
    queue: {
      total: queueTotal,
      by_department: queueByDepartment,
    },
    active: {
      total: activeTotal,
      by_agent: activeByAgent,
    },
    stats_today: {
      total_resolved: Number(stats?.total_resolved ?? 0),
      avg_resolution_minutes: Number(stats?.avg_resolution_minutes ?? 0),
      total_messages: Number(stats?.total_messages ?? 0),
    },
  };
}

export async function listMonitorBotConversations(schemaName: string): Promise<MonitorBotResponse> {
  const conversationsRef = tableRef(schemaName, 'conversations');
  const contactsRef = tableRef(schemaName, 'contacts');
  const channelsRef = tableRef(schemaName, 'channels');

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    protocol_number: string | null;
    created_at: Date;
    metadata: unknown;
    last_message: string | null;
    last_message_at: Date | null;
    contact_name: string | null;
    contact_phone: string | null;
    contact_whatsapp: string | null;
    channel_name: string | null;
    channel_type: string;
    minutes_in_bot: number | string;
  }>>(
    `SELECT
       c.id::text AS id,
       c.protocol_number,
       c.created_at,
       c.metadata,
       c.last_message,
       c.last_message_at,
       ct.name AS contact_name,
       ct.phone AS contact_phone,
       ct.whatsapp AS contact_whatsapp,
       ch.name AS channel_name,
       c.channel_type,
       EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 60 AS minutes_in_bot
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     LEFT JOIN ${channelsRef} ch ON ch.id = c.channel_id
     WHERE ${botEligibilityCondition('c')}
     ORDER BY c.created_at ASC`,
  );

  const conversations = rows.map((row) => ({
    id: row.id,
    protocol_number: row.protocol_number,
    created_at: row.created_at.toISOString(),
    metadata: normalizeMetadata(row.metadata),
    last_message: row.last_message,
    last_message_at: row.last_message_at ? row.last_message_at.toISOString() : null,
    contact_name: row.contact_name,
    contact_phone: row.contact_phone,
    contact_whatsapp: row.contact_whatsapp,
    channel_name: row.channel_name,
    channel_type: row.channel_type,
    minutes_in_bot: Number(row.minutes_in_bot ?? 0),
  }));

  return {
    conversations,
    total: conversations.length,
    stuck: conversations.filter((conversation) => conversation.minutes_in_bot > 10).length,
  };
}

async function ensureBotConversationState(
  schemaName: string,
  conversationId: string,
  operation: 'pull' | 'close',
): Promise<void> {
  const conversationsRef = tableRef(schemaName, 'conversations');
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    status: string;
    assigned_to: string | null;
    queue_entered_at: Date | null;
    bot_stage: string | null;
  }>>(
    `SELECT id::text AS id,
            status::text AS status,
            assigned_to::text AS assigned_to,
            queue_entered_at,
            metadata->>'bot_stage' AS bot_stage
     FROM ${conversationsRef}
     WHERE id = $1::uuid
     LIMIT 1`,
    conversationId,
  );

  const conversation = rows[0];
  if (!conversation) throw new MonitorBotNotFoundError('Conversa não encontrada');
  if (operation === 'close' && conversation.status === 'closed') {
    throw new MonitorBotConflictError('Conversa já encerrada');
  }
  if (
    conversation.status !== 'open'
    || conversation.assigned_to !== null
    || conversation.queue_entered_at !== null
    || conversation.bot_stage !== 'waiting_choice'
  ) {
    throw new MonitorBotInvalidStateError('Conversa não está no bot');
  }
}

export async function pullMonitorBotConversation(
  schemaName: string,
  conversationId: string,
  userId: string,
): Promise<{ conversationId: string; queue_entered_at: string }> {
  await ensureBotConversationState(schemaName, conversationId, 'pull');
  const safeSchema = quoteIdent(schemaName);

  const rows = await prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRawUnsafe<Array<{ id: string; queue_entered_at: Date }>>(
      `UPDATE ${safeSchema}.conversations c
       SET queue_entered_at = NOW(),
           metadata = (COALESCE(c.metadata, '{}'::jsonb) - 'bot_stage')
             || jsonb_build_object(
               'bot_stage', 'transferred',
               'bot_transferred_at', NOW(),
               'bot_transferred_by', $2::uuid
             )
       WHERE c.id = $1::uuid
         AND ${botEligibilityCondition('c')}
       RETURNING c.id::text AS id, c.queue_entered_at`,
      conversationId,
      userId,
    );

    if (!updated[0]) throw new MonitorBotInvalidStateError('Conversa não está no bot');

    await tx.$executeRawUnsafe(
      `INSERT INTO ${safeSchema}.messages
         (conversation_id, sender_type, content, content_type, is_internal, created_at)
       VALUES ($1::uuid, 'system', $2, 'text', true, NOW())`,
      conversationId,
      'Atendimento transferido para equipe humana pelo supervisor',
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO ${safeSchema}.audit_logs (user_id, action, entity, entity_id, new_data)
       VALUES ($1::uuid, 'conversation.bot.pulled', 'conversation', $2::uuid, $3::jsonb)`,
      userId,
      conversationId,
      JSON.stringify({ by: userId }),
    );

    return updated;
  });

  const updated = rows[0]!;
  return {
    conversationId: updated.id,
    queue_entered_at: updated.queue_entered_at.toISOString(),
  };
}

export async function closeMonitorBotConversation(
  schemaName: string,
  conversationId: string,
  userId: string,
  message?: string | null,
): Promise<{ conversationId: string; status: 'closed' }> {
  await ensureBotConversationState(schemaName, conversationId, 'close');
  const safeSchema = quoteIdent(schemaName);
  const closedAt = new Date();
  const closureReason = {
    reason: 'bot_stuck',
    notes: 'Encerrado pelo supervisor',
    resolvedAt: closedAt,
    agentId: userId,
  };
  const systemMessage = message?.trim() || 'Atendimento encerrado pelo supervisor.';

  await prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE ${safeSchema}.conversations c
       SET status = 'closed',
           closure_reason = $2::jsonb,
           closed_at = $3,
           resolved_at = $3,
           waiting_expires_at = NULL,
           queue_entered_at = NULL,
           metadata = COALESCE(c.metadata, '{}'::jsonb) || jsonb_build_object(
             'bot_closed_by', $4::uuid,
             'bot_closed_at', $3
           )
       WHERE c.id = $1::uuid
         AND ${botEligibilityCondition('c')}
       RETURNING c.id::text AS id`,
      conversationId,
      JSON.stringify(closureReason),
      closedAt,
      userId,
    );

    if (!updated[0]) throw new MonitorBotInvalidStateError('Conversa não está no bot');

    await tx.$executeRawUnsafe(
      `INSERT INTO ${safeSchema}.messages
         (conversation_id, sender_type, content, content_type, is_internal, created_at)
       VALUES ($1::uuid, 'system', $2, 'text', false, NOW())`,
      conversationId,
      systemMessage,
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO ${safeSchema}.audit_logs (user_id, action, entity, entity_id, new_data)
       VALUES ($1::uuid, 'conversation.bot.closed', 'conversation', $2::uuid, $3::jsonb)`,
      userId,
      conversationId,
      JSON.stringify({ by: userId, closure_reason: closureReason }),
    );
  });

  return { conversationId, status: 'closed' };
}
