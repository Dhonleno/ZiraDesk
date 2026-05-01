import { prisma } from '../../../config/database.js';
import {
  ensureAgentAssignmentsInfrastructure,
  ensureSkillsInfrastructure,
} from '../../omnichannel/conversations/auto-assign.service.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { AssignSkillInput, CreateSkillInput, UpdateSkillInput } from './skills.schema.js';

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  tag: string | null;
  color: string;
  is_active: boolean;
  created_at: Date;
}

interface AgentSkillRow extends SkillRow {
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
  skills: Array<{
    id: string;
    name: string;
    tag: string | null;
    color: string;
    level: 'junior' | 'intermediate' | 'senior';
  }>;
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
  await ensureSkillsInfrastructure(prisma, resolvedSchemaName);
  return resolvedSchemaName;
}

export async function listSkills(tenantId: string, schemaName?: string): Promise<SkillRow[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

  return prisma.$queryRawUnsafe<SkillRow[]>(
    `SELECT id, name, description, tag, color, is_active, created_at
     FROM ${skillsRef}
     WHERE is_active = true
     ORDER BY name ASC`,
  );
}

export async function createSkill(
  tenantId: string,
  data: CreateSkillInput,
  schemaName?: string,
): Promise<SkillRow> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

  const rows = await prisma.$queryRawUnsafe<SkillRow[]>(
    `INSERT INTO ${skillsRef} (name, description, tag, color)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, tag, color, is_active, created_at`,
    data.name.trim(),
    data.description?.trim() ?? null,
    data.tag?.trim() ?? null,
    data.color ?? '#00C9A7',
  );

  return rows[0]!;
}

export async function updateSkill(
  tenantId: string,
  skillId: string,
  data: UpdateSkillInput,
  schemaName?: string,
): Promise<SkillRow> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

  const rows = await prisma.$queryRawUnsafe<SkillRow[]>(
    `UPDATE ${skillsRef}
     SET name = COALESCE($1::text, name),
         description = COALESCE($2::text, description),
         tag = COALESCE($3::text, tag),
         color = COALESCE($4::text, color),
         is_active = COALESCE($5::boolean, is_active)
     WHERE id = $6::uuid
     RETURNING id, name, description, tag, color, is_active, created_at`,
    data.name?.trim() ?? null,
    data.description?.trim() ?? null,
    data.tag?.trim() ?? null,
    data.color ?? null,
    data.is_active ?? null,
    skillId,
  );

  if (!rows[0]) throw new NotFoundError('Skill nao encontrada');
  return rows[0];
}

export async function deleteSkill(
  tenantId: string,
  skillId: string,
  schemaName?: string,
): Promise<SkillRow> {
  return updateSkill(tenantId, skillId, { is_active: false }, schemaName);
}

export async function getAgentSkills(
  tenantId: string,
  userId: string,
  schemaName?: string,
): Promise<AgentSkillRow[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const skillsRef = tableRef(resolvedSchemaName, 'skills');
  const agentSkillsRef = tableRef(resolvedSchemaName, 'agent_skills');

  return prisma.$queryRawUnsafe<AgentSkillRow[]>(
    `SELECT s.id, s.name, s.description, s.tag, s.color, s.is_active, s.created_at, ask.level
     FROM ${skillsRef} s
     JOIN ${agentSkillsRef} ask ON ask.skill_id = s.id
     WHERE ask.user_id = $1::uuid
     ORDER BY s.name ASC`,
    userId,
  );
}

export async function assignSkill(
  tenantId: string,
  userId: string,
  data: AssignSkillInput,
  schemaName?: string,
): Promise<{ user_id: string; skill_id: string; level: string }> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const usersRef = tableRef(resolvedSchemaName, 'users');
  const skillsRef = tableRef(resolvedSchemaName, 'skills');
  const agentSkillsRef = tableRef(resolvedSchemaName, 'agent_skills');

  const userRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM ${usersRef} WHERE id = $1::uuid AND status = 'active' LIMIT 1`,
    userId,
  );
  if (!userRows[0]) throw new NotFoundError('Usuario nao encontrado');

  const skillRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM ${skillsRef} WHERE id = $1::uuid AND is_active = true LIMIT 1`,
    data.skill_id,
  );
  if (!skillRows[0]) throw new NotFoundError('Skill nao encontrada');

  const rows = await prisma.$queryRawUnsafe<Array<{ user_id: string; skill_id: string; level: string }>>(
    `INSERT INTO ${agentSkillsRef} (user_id, skill_id, level)
     VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (user_id, skill_id)
     DO UPDATE SET level = EXCLUDED.level
     RETURNING user_id, skill_id, level`,
    userId,
    data.skill_id,
    data.level,
  );

  return rows[0]!;
}

export async function removeSkill(
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

export async function getAgentsWithSkills(
  tenantId: string,
  schemaName?: string,
): Promise<AgentWithSkillsRow[]> {
  const resolvedSchemaName = await ensureInfra(tenantId, schemaName);
  const usersRef = tableRef(resolvedSchemaName, 'users');
  const assignmentsRef = tableRef(resolvedSchemaName, 'agent_assignments');
  const agentSkillsRef = tableRef(resolvedSchemaName, 'agent_skills');
  const skillsRef = tableRef(resolvedSchemaName, 'skills');

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
             'id', s.id,
             'name', s.name,
             'tag', s.tag,
             'color', s.color,
             'level', ask.level
           )
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::json
       ) AS skills
     FROM ${usersRef} u
     LEFT JOIN ${assignmentsRef} aa ON aa.user_id = u.id
     LEFT JOIN ${agentSkillsRef} ask ON ask.user_id = u.id
     LEFT JOIN ${skillsRef} s ON s.id = ask.skill_id AND s.is_active = true
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
