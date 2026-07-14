import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import { ensureSkillsInfrastructure } from '../skills/skills.infrastructure.js';
import type {
  AssignAgentSkillInput,
  AssignBotOptionSkillInput,
  CreateSkillInput,
  ListSkillsQueryInput,
  UpdateSkillInput,
} from './skills-v2.schema.js';

type SkillLevel = 'junior' | 'intermediate' | 'senior';

export interface SkillV2Row {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AgentSkillV2Row {
  skill_id: string;
  skill_name: string;
  level: SkillLevel;
}

export interface AgentWithSkillsV2Row {
  id: string;
  name: string;
  role: string;
  avatar_url: string | null;
  status: 'online' | 'paused' | 'offline' | string;
  is_available: boolean;
  active_conversations: number;
  pause_reason: string | null;
  pause_started_at: Date | null;
  skills: AgentSkillV2Row[];
}

export interface BotOptionSkillV2Row {
  skill_id: string;
  skill_name: string;
  required: boolean;
}

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
  await ensureSkillsInfrastructure(prisma, resolvedSchemaName);
  return resolvedSchemaName;
}

async function assertSkillNameAvailable(
  skillsRef: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${skillsRef}
     WHERE name = $1
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    name,
    exceptId ?? null,
  );

  if (rows[0]) throw new ConflictError('Habilidade ja cadastrada');
}

export async function listSkills(
  tenantId: string,
  query: ListSkillsQueryInput,
  schemaName?: string,
): Promise<SkillV2Row[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

  return prisma.$queryRawUnsafe<SkillV2Row[]>(
    `SELECT id, name, description, is_active, created_at, updated_at
     FROM ${skillsRef}
     WHERE ($1::boolean IS NULL OR is_active = $1::boolean)
     ORDER BY is_active DESC, name ASC`,
    query.is_active ?? null,
  );
}

export async function createSkill(
  tenantId: string,
  data: CreateSkillInput,
  schemaName?: string,
): Promise<SkillV2Row> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const skillsRef = tableRef(resolvedSchemaName, 'skills');
  const name = data.name.trim();

  await assertSkillNameAvailable(skillsRef, name);

  const rows = await prisma.$queryRawUnsafe<SkillV2Row[]>(
    `INSERT INTO ${skillsRef} (name, description, is_active)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, is_active, created_at, updated_at`,
    name,
    data.description?.trim() || null,
    data.is_active,
  );

  return rows[0]!;
}

export async function updateSkill(
  tenantId: string,
  id: string,
  data: UpdateSkillInput,
  schemaName?: string,
): Promise<SkillV2Row> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

  if (data.name !== undefined) {
    await assertSkillNameAvailable(skillsRef, data.name.trim(), id);
  }

  const setParts: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [id];
  let idx = 2;

  if (data.name !== undefined) {
    setParts.push(`name = $${idx++}`);
    params.push(data.name.trim());
  }

  if ('description' in data) {
    setParts.push(`description = $${idx++}`);
    params.push(data.description?.trim() || null);
  }

  if (data.is_active !== undefined) {
    setParts.push(`is_active = $${idx++}`);
    params.push(data.is_active);
  }

  const rows = await prisma.$queryRawUnsafe<SkillV2Row[]>(
    `UPDATE ${skillsRef}
     SET ${setParts.join(', ')}
     WHERE id = $1::uuid
     RETURNING id, name, description, is_active, created_at, updated_at`,
    ...params,
  );

  if (!rows[0]) throw new NotFoundError('Habilidade nao encontrada');
  return rows[0];
}

export async function deleteSkill(
  tenantId: string,
  id: string,
  schemaName?: string,
): Promise<{ deleted: boolean; deactivated: boolean }> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const skillsRef = tableRef(resolvedSchemaName, 'skills');
  const agentSkillsRef = tableRef(resolvedSchemaName, 'agent_skills');

  const existingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM ${skillsRef} WHERE id = $1::uuid LIMIT 1`,
    id,
  );
  if (!existingRows[0]) throw new NotFoundError('Habilidade nao encontrada');

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count
     FROM ${agentSkillsRef}
     WHERE skill_id = $1::uuid`,
    id,
  );
  const agentCount = Number(countRows[0]?.count ?? 0n);

  if (agentCount > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${skillsRef}
       SET is_active = false,
           updated_at = NOW()
       WHERE id = $1::uuid`,
      id,
    );
    return { deleted: false, deactivated: true };
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM ${skillsRef}
     WHERE id = $1::uuid`,
    id,
  );
  return { deleted: true, deactivated: false };
}

export async function listAgentsWithSkills(
  tenantId: string,
  schemaName?: string,
): Promise<AgentWithSkillsV2Row[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const usersRef = tableRef(resolvedSchemaName, 'users');
  const assignmentsRef = tableRef(resolvedSchemaName, 'agent_assignments');
  const agentSkillsRef = tableRef(resolvedSchemaName, 'agent_skills');
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

  return prisma.$queryRawUnsafe<AgentWithSkillsV2Row[]>(
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
             'skill_id', s.id,
             'skill_name', s.name,
             'level', aks.level
           )
           ORDER BY s.name ASC
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::json
       ) AS skills
     FROM ${usersRef} u
     LEFT JOIN ${assignmentsRef} aa ON aa.user_id = u.id
     LEFT JOIN ${agentSkillsRef} aks ON aks.user_id = u.id
     LEFT JOIN ${skillsRef} s ON s.id = aks.skill_id
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

export async function getAgentSkills(
  tenantId: string,
  userId: string,
  schemaName?: string,
): Promise<AgentSkillV2Row[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const agentSkillsRef = tableRef(resolvedSchemaName, 'agent_skills');
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

  return prisma.$queryRawUnsafe<AgentSkillV2Row[]>(
    `SELECT
       s.id AS skill_id,
       s.name AS skill_name,
       aks.level
     FROM ${agentSkillsRef} aks
     JOIN ${skillsRef} s ON s.id = aks.skill_id
     WHERE aks.user_id = $1::uuid
     ORDER BY s.name ASC`,
    userId,
  );
}

export async function assignAgentSkill(
  tenantId: string,
  userId: string,
  data: AssignAgentSkillInput,
  schemaName?: string,
): Promise<{ user_id: string; skill_id: string; level: SkillLevel }> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const usersRef = tableRef(resolvedSchemaName, 'users');
  const skillsRef = tableRef(resolvedSchemaName, 'skills');
  const agentSkillsRef = tableRef(resolvedSchemaName, 'agent_skills');

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

  const skillRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${skillsRef}
     WHERE id = $1::uuid
       AND is_active = true
     LIMIT 1`,
    data.skill_id,
  );
  if (!skillRows[0]) throw new NotFoundError('Habilidade nao encontrada');

  const rows = await prisma.$queryRawUnsafe<Array<{ user_id: string; skill_id: string; level: SkillLevel }>>(
    `INSERT INTO ${agentSkillsRef} (user_id, skill_id, level)
     VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (user_id, skill_id)
     DO UPDATE SET level = EXCLUDED.level,
                   updated_at = NOW()
     RETURNING user_id, skill_id, level`,
    userId,
    data.skill_id,
    data.level,
  );

  return rows[0]!;
}

export async function removeAgentSkill(
  tenantId: string,
  userId: string,
  skillId: string,
  schemaName?: string,
): Promise<{ removed: boolean }> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const agentSkillsRef = tableRef(resolvedSchemaName, 'agent_skills');

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `DELETE FROM ${agentSkillsRef}
     WHERE user_id = $1::uuid
       AND skill_id = $2::uuid
     RETURNING id`,
    userId,
    skillId,
  );

  return { removed: !!rows[0] };
}

export async function getBotOptionSkills(
  tenantId: string,
  botOptionId: string,
  schemaName?: string,
): Promise<BotOptionSkillV2Row[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const botOptionSkillsRef = tableRef(resolvedSchemaName, 'bot_option_skills');
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

  return prisma.$queryRawUnsafe<BotOptionSkillV2Row[]>(
    `SELECT
       s.id AS skill_id,
       s.name AS skill_name,
       bos.required
     FROM ${botOptionSkillsRef} bos
     JOIN ${skillsRef} s ON s.id = bos.skill_id
     WHERE bos.bot_option_id = $1::uuid
     ORDER BY bos.required DESC, s.name ASC`,
    botOptionId,
  );
}

export async function assignBotOptionSkill(
  tenantId: string,
  botOptionId: string,
  data: AssignBotOptionSkillInput,
  schemaName?: string,
): Promise<{ bot_option_id: string; skill_id: string; required: boolean }> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const botOptionsRef = tableRef(resolvedSchemaName, 'bot_options');
  const skillsRef = tableRef(resolvedSchemaName, 'skills');
  const botOptionSkillsRef = tableRef(resolvedSchemaName, 'bot_option_skills');

  const optionRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM ${botOptionsRef} WHERE id = $1::uuid LIMIT 1`,
    botOptionId,
  );
  if (!optionRows[0]) throw new NotFoundError('Opcao do bot nao encontrada');

  const skillRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${skillsRef}
     WHERE id = $1::uuid
       AND is_active = true
     LIMIT 1`,
    data.skill_id,
  );
  if (!skillRows[0]) throw new NotFoundError('Habilidade nao encontrada');

  const rows = await prisma.$queryRawUnsafe<Array<{ bot_option_id: string; skill_id: string; required: boolean }>>(
    `INSERT INTO ${botOptionSkillsRef} (bot_option_id, skill_id, required)
     VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (bot_option_id, skill_id)
     DO UPDATE SET required = EXCLUDED.required
     RETURNING bot_option_id, skill_id, required`,
    botOptionId,
    data.skill_id,
    data.required,
  );

  return rows[0]!;
}

export async function removeBotOptionSkill(
  tenantId: string,
  botOptionId: string,
  skillId: string,
  schemaName?: string,
): Promise<{ removed: boolean }> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const botOptionSkillsRef = tableRef(resolvedSchemaName, 'bot_option_skills');

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `DELETE FROM ${botOptionSkillsRef}
     WHERE bot_option_id = $1::uuid
       AND skill_id = $2::uuid
     RETURNING id`,
    botOptionId,
    skillId,
  );

  return { removed: !!rows[0] };
}
