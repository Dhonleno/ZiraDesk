import { prisma } from '../../../config/database.js';
import { ensureAgentAssignmentsInfrastructure } from '../../omnichannel/conversations/auto-assign.service.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { ToggleAgentAvailabilityInput, UpdateAutoAssignConfigInput } from './auto-assign.schema.js';

interface AgentRow {
  user_id: string;
  last_assigned_at: Date;
  active_conversations: number;
  is_available: boolean;
  status: string;
  pause_reason: string | null;
  pause_started_at: Date | null;
  pause_notes: string | null;
  created_at: Date;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
}

interface TenantSettings {
  auto_assign: boolean;
  auto_assign_algorithm: 'round_robin';
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

function normalizeTenantSettings(settings: unknown): TenantSettings {
  const safe = typeof settings === 'object' && settings !== null
    ? (settings as Record<string, unknown>)
    : {};

  return {
    auto_assign: safe['auto_assign'] === true,
    auto_assign_algorithm: safe['auto_assign_algorithm'] === 'round_robin' ? 'round_robin' : 'round_robin',
  };
}

async function resolveSchemaName(tenantId: string, schemaName?: string): Promise<string> {
  if (schemaName) return schemaName;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });

  if (!tenant) throw new NotFoundError('Tenant nao encontrado');
  return tenant.schemaName;
}

async function syncActiveConversations(schemaName: string): Promise<void> {
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

export async function getAgents(tenantId: string, schemaName?: string): Promise<AgentRow[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);
  await syncActiveConversations(resolvedSchemaName);

  const assignmentsRef = tableRef(resolvedSchemaName, 'agent_assignments');
  const usersRef = tableRef(resolvedSchemaName, 'users');

  return prisma.$queryRawUnsafe<AgentRow[]>(
    `SELECT
       aa.user_id,
       aa.last_assigned_at,
       aa.active_conversations,
       aa.is_available,
       aa.status,
       aa.pause_reason,
       aa.pause_started_at,
       aa.pause_notes,
       aa.created_at,
       u.name,
       u.email,
       u.avatar_url,
       u.role
     FROM ${assignmentsRef} aa
     JOIN ${usersRef} u ON u.id = aa.user_id
     WHERE u.status = 'active'
       AND u.role IN ('owner', 'admin', 'agent')
     ORDER BY u.name ASC`,
  );
}

export async function getConfig(tenantId: string, schemaName?: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  if (!tenant) throw new NotFoundError('Tenant nao encontrado');

  const settings = normalizeTenantSettings(tenant.settings);
  const agents = await getAgents(tenantId, schemaName);

  return {
    auto_assign: settings.auto_assign,
    auto_assign_algorithm: settings.auto_assign_algorithm,
    agents,
  };
}

export async function updateConfig(tenantId: string, data: UpdateAutoAssignConfigInput) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  if (!tenant) throw new NotFoundError('Tenant nao encontrado');

  const currentSettings =
    typeof tenant.settings === 'object' && tenant.settings !== null
      ? (tenant.settings as Record<string, unknown>)
      : {};

  const mergedSettings = {
    ...currentSettings,
    ...(data.auto_assign !== undefined ? { auto_assign: data.auto_assign } : {}),
    ...(data.auto_assign_algorithm !== undefined
      ? { auto_assign_algorithm: data.auto_assign_algorithm }
      : {}),
  };

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: mergedSettings },
  });

  return normalizeTenantSettings(mergedSettings);
}

export async function toggleAgentAvailability(
  tenantId: string,
  userId: string,
  data: ToggleAgentAvailabilityInput,
  schemaName?: string,
  enforceAssignableRole = true,
): Promise<AgentRow> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);

  const usersRef = tableRef(resolvedSchemaName, 'users');
  const assignmentsRef = tableRef(resolvedSchemaName, 'agent_assignments');

  const userRows = enforceAssignableRole
    ? await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM ${usersRef}
       WHERE id = $1::uuid
         AND status = 'active'
         AND role IN ('owner', 'admin', 'agent')
       LIMIT 1`,
      userId,
    )
    : await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM ${usersRef}
       WHERE id = $1::uuid
         AND status = 'active'
       LIMIT 1`,
      userId,
    );

  if (!userRows[0]) throw new NotFoundError('Agente nao encontrado ou inativo');

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${assignmentsRef} (user_id, is_available, status)
     VALUES ($1::uuid, $2::boolean, $3::text)
     ON CONFLICT (user_id)
     DO UPDATE SET is_available = EXCLUDED.is_available`,
    userId,
    data.is_available,
    data.is_available ? 'online' : 'offline',
  );

  if (data.is_available) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${assignmentsRef}
       SET status = 'online',
           pause_reason = NULL,
           pause_started_at = NULL,
           pause_notes = NULL,
           online_since = COALESCE(online_since, NOW())
       WHERE user_id = $1::uuid`,
      userId,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE ${assignmentsRef}
       SET status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'offline' END,
           online_since = NULL
       WHERE user_id = $1::uuid`,
      userId,
    );
  }

  await syncActiveConversations(resolvedSchemaName);

  const rows = await prisma.$queryRawUnsafe<AgentRow[]>(
    `SELECT
       aa.user_id,
       aa.last_assigned_at,
       aa.active_conversations,
       aa.is_available,
       aa.status,
       aa.pause_reason,
       aa.pause_started_at,
       aa.pause_notes,
       aa.created_at,
       u.name,
       u.email,
       u.avatar_url,
       u.role
     FROM ${assignmentsRef} aa
     JOIN ${usersRef} u ON u.id = aa.user_id
     WHERE aa.user_id = $1::uuid
     LIMIT 1`,
    userId,
  );

  if (!rows[0]) throw new NotFoundError('Agente nao encontrado');

  return rows[0];
}

export async function resetRoundRobin(tenantId: string, schemaName?: string): Promise<void> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);

  const assignmentsRef = tableRef(resolvedSchemaName, 'agent_assignments');

  await prisma.$executeRawUnsafe(
    `UPDATE ${assignmentsRef}
     SET last_assigned_at = NOW() - INTERVAL '1 year',
         active_conversations = 0`,
  );
}
