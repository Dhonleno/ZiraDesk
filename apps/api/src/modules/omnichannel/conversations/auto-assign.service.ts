import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { quoteIdent } from './protocols.js';
import { decryptCredentials } from '../../../utils/crypto.js';
import { logger } from '../../../config/logger.js';
import { sendWhatsAppTextMessage } from './csat.service.js';
import { PRESENCE_TIMEOUT_MS } from '../presence.constants.js';
import { getSocketServer } from '../../../socket/index.js';

interface AgentCandidateRow {
  user_id: string;
  name: string;
}

interface QueueConversationRow {
  id: string;
}

interface ConversationDispatchRow {
  id: string;
  whatsapp: string | null;
  phone: string | null;
  credentials: string | object | null;
  channel_type: string;
}

interface AutoAssignSettings {
  auto_assign: boolean;
  auto_assign_algorithm: 'round_robin';
  max_conversations_per_agent: number | null;
}

interface AgentAvailabilityRow {
  user_id: string;
  active_conversations: number;
  max_conversations: number | null;
  status: string;
  is_available: boolean;
}

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

function parseAutoAssignSettings(settings: unknown): AutoAssignSettings {
  const safe = typeof settings === 'object' && settings !== null
    ? (settings as Record<string, unknown>)
    : {};

  const rawLimit = safe['max_conversations_per_agent'];
  return {
    auto_assign: safe['auto_assign'] === true,
    auto_assign_algorithm: safe['auto_assign_algorithm'] === 'round_robin' ? 'round_robin' : 'round_robin',
    max_conversations_per_agent:
      typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit >= 1
        ? rawLimit
        : null,
  };
}

export async function ensureAgentAssignmentsInfrastructure(
  prisma: PrismaClient,
  schemaName: string,
): Promise<void> {
  const usersRef = tableRef(schemaName, 'users');
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const pauseReasonsRef = tableRef(schemaName, 'pause_reasons');
  const pauseHistoryRef = tableRef(schemaName, 'agent_pause_history');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${assignmentsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES ${usersRef}(id) ON DELETE CASCADE,
      last_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active_conversations INTEGER NOT NULL DEFAULT 0,
      is_available BOOLEAN NOT NULL DEFAULT false,
      status VARCHAR(20) NOT NULL DEFAULT 'offline',
      last_seen_at TIMESTAMPTZ,
      pause_reason VARCHAR(100),
      pause_started_at TIMESTAMPTZ,
      pause_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${assignmentsRef}
    ADD COLUMN IF NOT EXISTS max_conversations INTEGER DEFAULT NULL
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${assignmentsRef}
    ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'offline',
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(100),
    ADD COLUMN IF NOT EXISTS pause_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pause_notes TEXT
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${assignmentsRef}
    ALTER COLUMN is_available SET DEFAULT false,
    ALTER COLUMN status SET DEFAULT 'offline'
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${assignmentsRef}
    ADD COLUMN IF NOT EXISTS online_since TIMESTAMPTZ
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO ${assignmentsRef} (user_id, is_available, status)
    SELECT id
         , false
         , 'offline'
    FROM ${usersRef}
    WHERE status = 'active'
      AND role IN ('owner', 'admin', 'supervisor', 'agent')
    ON CONFLICT (user_id) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE ${assignmentsRef}
    SET status = CASE WHEN COALESCE(is_available, false) THEN 'online' ELSE 'offline' END
    WHERE status IS NULL OR status = ''
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE ${assignmentsRef}
    SET last_seen_at = NOW()
    WHERE last_seen_at IS NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${pauseReasonsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label VARCHAR(100) NOT NULL UNIQUE,
      icon VARCHAR(10) NOT NULL DEFAULT '⏸️',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO ${pauseReasonsRef} (label, icon, sort_order)
    VALUES
      ('Almoço', '🍽️', 1),
      ('Banheiro', '🚻', 2),
      ('Reunião', '📋', 3),
      ('Intervalo', '☕', 4),
      ('Treinamento', '📚', 5),
      ('Outro', '⏸️', 99)
    ON CONFLICT (label) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${pauseHistoryRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES ${usersRef}(id) ON DELETE SET NULL,
      pause_reason VARCHAR(100),
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      duration_seconds INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function ensureAgentBotSkillsInfrastructure(
  prisma: PrismaClient,
  schemaName: string,
): Promise<void> {
  const usersRef = tableRef(schemaName, 'users');
  const botOptionsRef = tableRef(schemaName, 'bot_options');
  const agentBotSkillsRef = tableRef(schemaName, 'agent_bot_skills');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${agentBotSkillsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES ${usersRef}(id) ON DELETE CASCADE,
      bot_option_id UUID REFERENCES ${botOptionsRef}(id) ON DELETE CASCADE,
      level VARCHAR(20) DEFAULT 'intermediate',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, bot_option_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_agent_bot_skills_user
    ON ${agentBotSkillsRef}(user_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_agent_bot_skills_option
    ON ${agentBotSkillsRef}(bot_option_id)
  `);
}

async function resolveAgentForAssignment(
  prisma: PrismaClient,
  schemaName: string,
  io: Server,
  preferredAgentId?: string,
  requiredBotOptionId?: string,
  globalLimit?: number | null,
): Promise<AgentCandidateRow | null> {
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const usersRef = tableRef(schemaName, 'users');
  const botOptionsRef = tableRef(schemaName, 'bot_options');
  const agentBotSkillsRef = tableRef(schemaName, 'agent_bot_skills');

  const pickConnectedCandidate = async (
    candidates: AgentCandidateRow[],
  ): Promise<AgentCandidateRow | null> => {
    for (const candidate of candidates) {
      const connectedSockets = await io.in(`agent:${candidate.user_id}`).fetchSockets();
      if (connectedSockets.length > 0) return candidate;

      // Corrige estado stale para evitar novas atribuições em agente já desconectado.
      await prisma.$executeRawUnsafe(
        `UPDATE ${assignmentsRef}
         SET status = 'offline',
             is_available = false,
             online_since = NULL
         WHERE user_id = $1::uuid
           AND status = 'online'`,
        candidate.user_id,
      );
    }
    return null;
  };

  if (preferredAgentId) {
    const preferredRows = await prisma.$queryRawUnsafe<AgentCandidateRow[]>(
      `SELECT aa.user_id, u.name
       FROM ${assignmentsRef} aa
       JOIN ${usersRef} u ON u.id = aa.user_id
       WHERE aa.user_id = $1::uuid
         AND aa.is_available = true
         AND aa.status = 'online'
         AND aa.last_seen_at > NOW() - (${PRESENCE_TIMEOUT_MS / 60_000} * INTERVAL '1 minute')
         AND u.status = 'active'
         AND u.role IN ('agent')
         AND aa.active_conversations < COALESCE(aa.max_conversations, $2::integer, 999999)
       LIMIT 1`,
      preferredAgentId,
      globalLimit ?? null,
    );

    const preferredConnected = await pickConnectedCandidate(preferredRows);
    if (preferredConnected) return preferredConnected;
  }

  if (requiredBotOptionId?.trim()) {
    const rowsBySkill = await prisma.$queryRawUnsafe<AgentCandidateRow[]>(
      `WITH RECURSIVE option_scope AS (
         SELECT id, parent_option_id
         FROM ${botOptionsRef}
         WHERE id = $1::uuid
         UNION ALL
         SELECT parent.id, parent.parent_option_id
         FROM ${botOptionsRef} parent
         JOIN option_scope current ON current.parent_option_id = parent.id
       )
       SELECT aa.user_id, u.name
       FROM ${assignmentsRef} aa
       JOIN ${usersRef} u ON u.id = aa.user_id
       JOIN ${agentBotSkillsRef} abs ON abs.user_id = aa.user_id
       WHERE aa.is_available = true
         AND aa.status = 'online'
         AND aa.last_seen_at > NOW() - (${PRESENCE_TIMEOUT_MS / 60_000} * INTERVAL '1 minute')
         AND u.status = 'active'
         AND u.role IN ('agent')
         AND abs.bot_option_id IN (SELECT id FROM option_scope)
         AND aa.active_conversations < COALESCE(aa.max_conversations, $2::integer, 999999)
       ORDER BY aa.last_assigned_at ASC
       LIMIT 15`,
      requiredBotOptionId.trim(),
      globalLimit ?? null,
    );

    const connectedBySkill = await pickConnectedCandidate(rowsBySkill);
    if (connectedBySkill) return connectedBySkill;
    return null;
  }

  const rows = await prisma.$queryRawUnsafe<AgentCandidateRow[]>(
    `SELECT aa.user_id, u.name
     FROM ${assignmentsRef} aa
     JOIN ${usersRef} u ON u.id = aa.user_id
     WHERE aa.is_available = true
       AND aa.status = 'online'
       AND aa.last_seen_at > NOW() - (${PRESENCE_TIMEOUT_MS / 60_000} * INTERVAL '1 minute')
       AND u.status = 'active'
       AND u.role IN ('agent')
       AND aa.active_conversations < COALESCE(aa.max_conversations, $1::integer, 999999)
     ORDER BY aa.last_assigned_at ASC
     LIMIT 15`,
    globalLimit ?? null,
  );

  return pickConnectedCandidate(rows);
}

async function syncAllActiveConversationCounters(
  prisma: PrismaClient,
  schemaName: string,
): Promise<void> {
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const conversationsRef = tableRef(schemaName, 'conversations');

  await prisma.$executeRawUnsafe(
    `UPDATE ${assignmentsRef} aa
     SET active_conversations = COALESCE(conv.total, 0)
     FROM (
       SELECT assigned_to AS user_id, COUNT(*)::integer AS total
       FROM ${conversationsRef}
       WHERE assigned_to IS NOT NULL
         AND status IN ('open', 'in_service', 'pending', 'bot')
       GROUP BY assigned_to
     ) conv
     WHERE aa.user_id = conv.user_id`,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${assignmentsRef}
     SET active_conversations = 0
     WHERE user_id NOT IN (
       SELECT DISTINCT assigned_to
       FROM ${conversationsRef}
       WHERE assigned_to IS NOT NULL
         AND status IN ('open', 'in_service', 'pending', 'bot')
     )`,
  );
}

async function persistAutoAssignment(
  prisma: PrismaClient,
  schemaName: string,
  _tenantSettings: unknown,
  conversationId: string,
  agentId: string,
  agentName: string,
): Promise<boolean> {
  const conversationsRef = tableRef(schemaName, 'conversations');
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const messagesRef = tableRef(schemaName, 'messages');
  const contactsRef = tableRef(schemaName, 'contacts');

  const updatedRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE ${conversationsRef}
     SET assigned_to = $1::uuid,
         assigned_at = NOW(),
         status = 'open'
     WHERE id = $2::uuid
       AND assigned_to IS NULL
     RETURNING id`,
    agentId,
    conversationId,
  );

  if (!updatedRows[0]) return false;

  await prisma.$executeRawUnsafe(
    `UPDATE ${assignmentsRef}
     SET last_assigned_at = NOW(),
         active_conversations = (
           SELECT COUNT(*)::integer
           FROM ${conversationsRef}
           WHERE assigned_to = $1::uuid
             AND status IN ('open', 'in_service', 'pending', 'bot')
         )
     WHERE user_id = $1::uuid`,
    agentId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${messagesRef} (id, conversation_id, sender_type, content, content_type, is_internal, created_at)
     VALUES (gen_random_uuid(), $1::uuid, 'system', $2, 'text', true, NOW())`,
    conversationId,
    `Atendimento atribuido automaticamente para ${agentName}`,
  );

  const contactRows = await prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
    `SELECT ct.name
     FROM ${conversationsRef} c
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  const contactName = contactRows[0]?.name ?? 'Cliente';

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
    await tx.$executeRawUnsafe(
      `INSERT INTO audit_logs (
         user_id, action, entity, entity_id, new_data, created_at
       ) VALUES (
         $1::uuid,
         'conversation.assigned',
         'conversation',
         $2::uuid,
         $3::jsonb,
         NOW()
       )`,
      agentId,
      conversationId,
      JSON.stringify({
        assigned_to: agentId,
        contact_name: contactName,
        status: 'open',
        source: 'auto_assign',
      }),
    );
  });

  try {
    const convRows = await prisma.$queryRawUnsafe<ConversationDispatchRow[]>(
      `SELECT
         c.id,
         ct.whatsapp,
         ct.phone,
         ch.credentials,
         ch.type AS channel_type
       FROM ${conversationsRef} c
       JOIN ${tableRef(schemaName, 'contacts')} ct ON ct.id = c.contact_id
       JOIN ${tableRef(schemaName, 'channels')} ch ON ch.id = c.channel_id
       WHERE c.id = $1::uuid
       LIMIT 1`,
      conversationId,
    );

    const conversation = convRows[0];
    if (!conversation || conversation.channel_type !== 'whatsapp') return true;

    const credentials = conversation.credentials ? decryptCredentials(conversation.credentials) : {};
    const phoneNumberId = credentials.phoneNumberId ?? credentials.phone_number_id;
    const accessToken = credentials.accessToken ?? credentials.access_token;
    const clientPhone = (conversation.whatsapp ?? conversation.phone ?? '').replace(/\D/g, '');
    if (!phoneNumberId || !accessToken || !clientPhone) return true;

    const assignMessage = `Olá! Meu nome é *${agentName}*. Em que posso ajudar?`;

    const sent = await sendWhatsAppTextMessage({
      text: assignMessage,
      to: clientPhone,
      phoneNumberId,
      accessToken,
    });

    if (sent) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${messagesRef} (id, conversation_id, sender_type, content, content_type, is_internal, created_at)
         VALUES (gen_random_uuid(), $1::uuid, 'bot', $2, 'text', false, NOW())`,
        conversationId,
        assignMessage,
      );
    }
  } catch (error) {
    logger.error({ conversationId, agentId, err: error instanceof Error ? error.message : String(error) }, '[AutoAssign] Failed to notify customer after assignment');
  }

  return true;
}

function emitAssignmentEvents(
  io: Server,
  tenantId: string,
  conversationId: string,
  agentId: string,
  agentName: string,
): void {
  io.to(`tenant:${tenantId}`).emit('conversation:updated', {
    conversationId,
    assigned_to: agentId,
    assigned_name: agentName,
    status: 'open',
  });

  io.to(`agent:${agentId}`).emit('conversation:assigned', {
    conversationId,
    message: 'Nova conversa atribuida automaticamente',
  });

  io.to(`agent:${agentId}`).emit('notification:new', {
    type: 'conversation.assigned',
    title: 'Nova conversa atribuida',
    message: 'Uma conversa foi atribuida automaticamente para voce',
    conversationId,
    createdAt: new Date().toISOString(),
  });
}

export async function syncAgentAvailability(
  prisma: PrismaClient,
  schemaName: string,
  agentIds: Array<string | null | undefined>,
  tenantId: string,
): Promise<void> {
  const uniqueIds = [...new Set(agentIds.filter((id): id is string => Boolean(id)))];
  if (uniqueIds.length === 0) return;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const { max_conversations_per_agent: globalLimit } = parseAutoAssignSettings(tenant?.settings);

  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const conversationsRef = tableRef(schemaName, 'conversations');
  const io = getSocketServer();

  for (const agentId of uniqueIds) {
    const rows = await prisma.$queryRawUnsafe<AgentAvailabilityRow[]>(
      `UPDATE ${assignmentsRef}
       SET active_conversations = (
         SELECT COUNT(*)::integer
         FROM ${conversationsRef}
         WHERE assigned_to = $1::uuid
           AND status IN ('open', 'in_service', 'pending', 'bot')
       )
       WHERE user_id = $1::uuid
       RETURNING user_id, active_conversations, max_conversations, status, is_available`,
      agentId,
    );

    const agent = rows[0];
    if (!agent || agent.status !== 'online') continue;

    const effectiveLimit = agent.max_conversations ?? globalLimit;
    if (effectiveLimit === null) continue;

    const shouldBeAvailable = agent.active_conversations < effectiveLimit;
    if (agent.is_available === shouldBeAvailable) continue;

    await prisma.$executeRawUnsafe(
      `UPDATE ${assignmentsRef}
       SET is_available = $2::boolean
       WHERE user_id = $1::uuid
         AND status = 'online'`,
      agentId,
      shouldBeAvailable,
    );

    io.to(`tenant:${tenantId}`).emit('agent:updated', {
      agentId,
      isAvailable: shouldBeAvailable,
      ...(shouldBeAvailable ? {} : { reason: 'max_conversations_reached' }),
    });
  }
}

export async function autoAssignConversation(
  conversationId: string,
  tenantId: string,
  schemaName: string,
  prisma: PrismaClient,
  io: Server,
  preferredAgentId?: string,
  requiredBotOptionId?: string,
): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  const settings = parseAutoAssignSettings(tenant?.settings);
  if (!settings.auto_assign || settings.auto_assign_algorithm !== 'round_robin') return null;

  await ensureAgentAssignmentsInfrastructure(prisma, schemaName);
  await ensureAgentBotSkillsInfrastructure(prisma, schemaName);
  await syncAllActiveConversationCounters(prisma, schemaName);

  const nextAgent = await resolveAgentForAssignment(
    prisma,
    schemaName,
    io,
    preferredAgentId,
    requiredBotOptionId,
    settings.max_conversations_per_agent,
  );
  if (!nextAgent) {
    if (requiredBotOptionId) {
      logger.info({ optionId: requiredBotOptionId }, '[AutoAssign] No agent with skill for option, keeping in queue');
    }
    return null;
  }

  const assigned = await persistAutoAssignment(
    prisma,
    schemaName,
    tenant?.settings,
    conversationId,
    nextAgent.user_id,
    nextAgent.name,
  );

  if (!assigned) return null;

  await syncAgentAvailability(prisma, schemaName, [nextAgent.user_id], tenantId);

  emitAssignmentEvents(io, tenantId, conversationId, nextAgent.user_id, nextAgent.name);

  return nextAgent.user_id;
}

export async function autoAssignNextQueuedConversation(
  tenantId: string,
  schemaName: string,
  prisma: PrismaClient,
  io: Server,
  preferredAgentId?: string,
): Promise<string | null> {
  const conversationsRef = tableRef(schemaName, 'conversations');

  const queueRows = await prisma.$queryRawUnsafe<QueueConversationRow[]>(
    `SELECT id
     FROM ${conversationsRef}
     WHERE assigned_to IS NULL
       AND status IN ('open', 'pending', 'bot')
     ORDER BY last_message_at ASC NULLS FIRST, created_at ASC
     LIMIT 1`,
  );

  const conversationId = queueRows[0]?.id;
  if (!conversationId) return null;

  return autoAssignConversation(
    conversationId,
    tenantId,
    schemaName,
    prisma,
    io,
    preferredAgentId,
  );
}
