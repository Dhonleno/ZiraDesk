import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { quoteIdent } from './protocols.js';

interface AgentCandidateRow {
  user_id: string;
  name: string;
}

interface QueueConversationRow {
  id: string;
}

interface AutoAssignSettings {
  auto_assign: boolean;
  auto_assign_algorithm: 'round_robin';
}

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

function parseAutoAssignSettings(settings: unknown): AutoAssignSettings {
  const safe = typeof settings === 'object' && settings !== null
    ? (settings as Record<string, unknown>)
    : {};

  return {
    auto_assign: safe['auto_assign'] === true,
    auto_assign_algorithm: safe['auto_assign_algorithm'] === 'round_robin' ? 'round_robin' : 'round_robin',
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
      is_available BOOLEAN NOT NULL DEFAULT true,
      status VARCHAR(20) NOT NULL DEFAULT 'online',
      pause_reason VARCHAR(100),
      pause_started_at TIMESTAMPTZ,
      pause_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${assignmentsRef}
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'online',
    ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(100),
    ADD COLUMN IF NOT EXISTS pause_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pause_notes TEXT
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO ${assignmentsRef} (user_id)
    SELECT id
    FROM ${usersRef}
    WHERE status = 'active'
      AND role IN ('owner', 'admin', 'agent')
    ON CONFLICT (user_id) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE ${assignmentsRef}
    SET status = CASE WHEN COALESCE(is_available, false) THEN 'online' ELSE 'offline' END
    WHERE status IS NULL OR status = ''
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
  preferredAgentId?: string,
  requiredBotOptionId?: string,
): Promise<AgentCandidateRow | null> {
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const usersRef = tableRef(schemaName, 'users');
  const botOptionsRef = tableRef(schemaName, 'bot_options');
  const agentBotSkillsRef = tableRef(schemaName, 'agent_bot_skills');

  if (preferredAgentId) {
    const preferredRows = await prisma.$queryRawUnsafe<AgentCandidateRow[]>(
      `SELECT aa.user_id, u.name
       FROM ${assignmentsRef} aa
       JOIN ${usersRef} u ON u.id = aa.user_id
       WHERE aa.user_id = $1::uuid
         AND aa.is_available = true
         AND aa.status = 'online'
         AND u.status = 'active'
         AND u.role IN ('owner', 'admin', 'agent')
       LIMIT 1`,
      preferredAgentId,
    );

    if (preferredRows[0]) return preferredRows[0];
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
         AND u.status = 'active'
         AND u.role IN ('owner', 'admin', 'agent')
         AND abs.bot_option_id IN (SELECT id FROM option_scope)
       ORDER BY aa.last_assigned_at ASC
       LIMIT 1`,
      requiredBotOptionId.trim(),
    );

    if (rowsBySkill[0]) return rowsBySkill[0];
    return null;
  }

  const rows = await prisma.$queryRawUnsafe<AgentCandidateRow[]>(
    `SELECT aa.user_id, u.name
     FROM ${assignmentsRef} aa
     JOIN ${usersRef} u ON u.id = aa.user_id
     WHERE aa.is_available = true
       AND aa.status = 'online'
       AND u.status = 'active'
       AND u.role IN ('owner', 'admin', 'agent')
     ORDER BY aa.last_assigned_at ASC
     LIMIT 1`,
  );

  return rows[0] ?? null;
}

async function persistAutoAssignment(
  prisma: PrismaClient,
  schemaName: string,
  conversationId: string,
  agentId: string,
  agentName: string,
): Promise<boolean> {
  const conversationsRef = tableRef(schemaName, 'conversations');
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const messagesRef = tableRef(schemaName, 'messages');

  const updatedRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE ${conversationsRef}
     SET assigned_to = $1::uuid,
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
             AND status IN ('open', 'active_outbound', 'in_service', 'pending', 'bot')
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

  const nextAgent = await resolveAgentForAssignment(
    prisma,
    schemaName,
    preferredAgentId,
    requiredBotOptionId,
  );
  if (!nextAgent) {
    if (requiredBotOptionId) {
      console.log(`[AutoAssign] No agent with skill for option ${requiredBotOptionId}. Keeping in queue.`);
    }
    return null;
  }

  const assigned = await persistAutoAssignment(
    prisma,
    schemaName,
    conversationId,
    nextAgent.user_id,
    nextAgent.name,
  );

  if (!assigned) return null;

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
