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

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${assignmentsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES ${usersRef}(id) ON DELETE CASCADE,
      last_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active_conversations INTEGER NOT NULL DEFAULT 0,
      is_available BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO ${assignmentsRef} (user_id)
    SELECT id
    FROM ${usersRef}
    WHERE status = 'active'
      AND role IN ('owner', 'admin', 'agent')
    ON CONFLICT (user_id) DO NOTHING
  `);
}

async function resolveAgentForAssignment(
  prisma: PrismaClient,
  schemaName: string,
  preferredAgentId?: string,
): Promise<AgentCandidateRow | null> {
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');
  const usersRef = tableRef(schemaName, 'users');

  if (preferredAgentId) {
    const preferredRows = await prisma.$queryRawUnsafe<AgentCandidateRow[]>(
      `SELECT aa.user_id, u.name
       FROM ${assignmentsRef} aa
       JOIN ${usersRef} u ON u.id = aa.user_id
       WHERE aa.user_id = $1::uuid
         AND aa.is_available = true
         AND u.status = 'active'
         AND u.role IN ('owner', 'admin', 'agent')
       LIMIT 1`,
      preferredAgentId,
    );

    if (preferredRows[0]) return preferredRows[0];
  }

  const rows = await prisma.$queryRawUnsafe<AgentCandidateRow[]>(
    `SELECT aa.user_id, u.name
     FROM ${assignmentsRef} aa
     JOIN ${usersRef} u ON u.id = aa.user_id
     WHERE aa.is_available = true
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
): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  const settings = parseAutoAssignSettings(tenant?.settings);
  if (!settings.auto_assign || settings.auto_assign_algorithm !== 'round_robin') return null;

  await ensureAgentAssignmentsInfrastructure(prisma, schemaName);

  const nextAgent = await resolveAgentForAssignment(prisma, schemaName, preferredAgentId);
  if (!nextAgent) return null;

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
