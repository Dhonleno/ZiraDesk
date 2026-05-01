import { prisma } from '../../../config/database.js';
import {
  ensureAgentAssignmentsInfrastructure,
  ensureAgentBotSkillsInfrastructure,
} from '../../omnichannel/conversations/auto-assign.service.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { AssignSkillInput } from './skills.schema.js';

interface BotOptionSkillRow {
  id: string;
  number: number;
  label: string;
  tag: string | null;
  has_submenu: boolean;
  parent_option_id: string | null;
  sort_order: number;
  agents_count: number;
}

interface AgentSkillRow {
  bot_option_id: string;
  id: string;
  label: string;
  name: string;
  tag: string | null;
  parent_label: string | null;
  level: 'junior' | 'intermediate' | 'senior';
}

interface AgentWithSkillsRow {
  id: string;
  name: string;
  role: string;
  avatar_url: string | null;
  status: 'online' | 'paused' | 'offline' | string;
  is_available: boolean;
  active_conversations: number;
  pause_reason: string | null;
  pause_started_at: Date | null;
  skills: AgentSkillRow[];
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

async function resolveSchemaName(tenantId: string, schemaName?: string): Promise<string> {
  if (schemaName) return schemaName;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });

  if (!tenant) throw new NotFoundError('Tenant nao encontrado');
  return tenant.schemaName;
}

async function ensureInfra(tenantId: string, schemaName?: string): Promise<string> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);
  await ensureAgentBotSkillsInfrastructure(prisma, resolvedSchemaName);
  return resolvedSchemaName;
}

export async function getBotOptionsTree(tenantId: string, schemaName?: string): Promise<BotOptionSkillRow[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const botOptionsRef = tableRef(resolvedSchemaName, 'bot_options');
  const agentBotSkillsRef = tableRef(resolvedSchemaName, 'agent_bot_skills');

  return prisma.$queryRawUnsafe<BotOptionSkillRow[]>(
    `SELECT
       bo.id,
       bo.number,
       bo.label,
       bo.tag,
       bo.has_submenu,
       bo.parent_option_id,
       bo.sort_order,
       COUNT(abs.user_id)::integer AS agents_count
     FROM ${botOptionsRef} bo
     LEFT JOIN ${agentBotSkillsRef} abs ON abs.bot_option_id = bo.id
     GROUP BY
       bo.id,
       bo.number,
       bo.label,
       bo.tag,
       bo.has_submenu,
       bo.parent_option_id,
       bo.sort_order
     ORDER BY bo.sort_order ASC, bo.number ASC`,
  );
}

export async function getAgentSkills(
  tenantId: string,
  userId: string,
  schemaName?: string,
): Promise<AgentSkillRow[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const botOptionsRef = tableRef(resolvedSchemaName, 'bot_options');
  const agentBotSkillsRef = tableRef(resolvedSchemaName, 'agent_bot_skills');

  return prisma.$queryRawUnsafe<AgentSkillRow[]>(
    `SELECT
       bo.id AS bot_option_id,
       bo.id AS id,
       bo.label,
       bo.label AS name,
       bo.tag,
       parent.label AS parent_label,
       abs.level
     FROM ${botOptionsRef} bo
     JOIN ${agentBotSkillsRef} abs ON abs.bot_option_id = bo.id
     LEFT JOIN ${botOptionsRef} parent ON parent.id = bo.parent_option_id
     WHERE abs.user_id = $1::uuid
     ORDER BY bo.sort_order ASC, bo.number ASC`,
    userId,
  );
}

export async function assignBotSkill(
  tenantId: string,
  userId: string,
  data: AssignSkillInput,
  schemaName?: string,
): Promise<{ user_id: string; bot_option_id: string; level: string }> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const usersRef = tableRef(resolvedSchemaName, 'users');
  const botOptionsRef = tableRef(resolvedSchemaName, 'bot_options');
  const agentBotSkillsRef = tableRef(resolvedSchemaName, 'agent_bot_skills');

  const userRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${usersRef}
     WHERE id = $1::uuid
       AND status = 'active'
       AND role IN ('owner', 'admin', 'agent')
     LIMIT 1`,
    userId,
  );
  if (!userRows[0]) throw new NotFoundError('Usuario nao encontrado');

  const optionRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM ${botOptionsRef} WHERE id = $1::uuid LIMIT 1`,
    data.bot_option_id,
  );
  if (!optionRows[0]) throw new NotFoundError('Opcao do bot nao encontrada');

  const rows = await prisma.$queryRawUnsafe<Array<{ user_id: string; bot_option_id: string; level: string }>>(
    `INSERT INTO ${agentBotSkillsRef} (user_id, bot_option_id, level)
     VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (user_id, bot_option_id)
     DO UPDATE SET level = EXCLUDED.level
     RETURNING user_id, bot_option_id, level`,
    userId,
    data.bot_option_id,
    data.level,
  );

  return rows[0]!;
}

export async function removeBotSkill(
  tenantId: string,
  userId: string,
  botOptionId: string,
  schemaName?: string,
): Promise<{ removed: boolean }> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const agentBotSkillsRef = tableRef(resolvedSchemaName, 'agent_bot_skills');

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `DELETE FROM ${agentBotSkillsRef}
     WHERE user_id = $1::uuid
       AND bot_option_id = $2::uuid
     RETURNING id`,
    userId,
    botOptionId,
  );

  return { removed: !!rows[0] };
}

export async function getAgentsWithSkills(
  tenantId: string,
  schemaName?: string,
): Promise<AgentWithSkillsRow[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const usersRef = tableRef(resolvedSchemaName, 'users');
  const assignmentsRef = tableRef(resolvedSchemaName, 'agent_assignments');
  const agentBotSkillsRef = tableRef(resolvedSchemaName, 'agent_bot_skills');
  const botOptionsRef = tableRef(resolvedSchemaName, 'bot_options');

  return prisma.$queryRawUnsafe<AgentWithSkillsRow[]>(
    `SELECT
       u.id,
       u.name,
       u.role,
       u.avatar_url,
       COALESCE(aa.status, 'offline') AS status,
       COALESCE(aa.is_available, false) AS is_available,
       COALESCE(aa.active_conversations, 0) AS active_conversations,
       aa.pause_reason,
       aa.pause_started_at,
       COALESCE(
         json_agg(
           json_build_object(
             'bot_option_id', bo.id,
             'id', bo.id,
             'label', bo.label,
             'name', bo.label,
             'tag', bo.tag,
             'level', abs.level,
             'parent_label', parent.label
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
       AND u.role IN ('owner', 'admin', 'agent')
     GROUP BY
       u.id,
       u.name,
       u.role,
       u.avatar_url,
       aa.status,
       aa.is_available,
       aa.active_conversations,
       aa.pause_reason,
       aa.pause_started_at
     ORDER BY u.name ASC`,
  );
}
