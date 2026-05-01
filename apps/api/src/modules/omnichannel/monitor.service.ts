import { prisma } from '../../config/database.js';
import {
  ensureAgentAssignmentsInfrastructure,
  ensureSkillsInfrastructure,
} from './conversations/auto-assign.service.js';

interface MonitorAgent {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  status: 'online' | 'paused' | 'offline' | string;
  pause_reason: string | null;
  pause_started_at: string | null;
  active_conversations: number;
  skills: Array<{
    id: string;
    name: string;
    tag: string | null;
    color: string;
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

export async function getMonitorSnapshot(schemaName: string): Promise<MonitorResponse> {
  await ensureAgentAssignmentsInfrastructure(prisma, schemaName);
  await ensureSkillsInfrastructure(prisma, schemaName);

  const [agents, queueRows, activeRows, statsRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      avatar_url: string | null;
      role: string;
      status: string;
      pause_reason: string | null;
      pause_started_at: Date | null;
      active_conversations: number;
      skills: MonitorAgent['skills'];
    }>>(
      `SELECT
         u.id,
         u.name,
         u.avatar_url,
         u.role,
         COALESCE(aa.status, 'offline') AS status,
         aa.pause_reason,
         aa.pause_started_at,
         COALESCE(aa.active_conversations, 0) AS active_conversations,
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
       FROM users u
       LEFT JOIN agent_assignments aa ON aa.user_id = u.id
       LEFT JOIN agent_skills ask ON ask.user_id = u.id
       LEFT JOIN skills s ON s.id = ask.skill_id AND s.is_active = true
       WHERE u.status = 'active'
         AND u.role IN ('owner', 'admin', 'agent')
       GROUP BY
         u.id,
         u.name,
         u.avatar_url,
         u.role,
         aa.status,
         aa.pause_reason,
         aa.pause_started_at,
         aa.active_conversations
       ORDER BY u.name ASC`,
    ),
    prisma.$queryRawUnsafe<Array<{ tag: string | null; total: bigint }>>(
      `SELECT
         NULLIF(TRIM(COALESCE(metadata->>'bot_tag', '')), '') AS tag,
         COUNT(*) AS total
       FROM conversations
       WHERE assigned_to IS NULL
         AND status IN ('open', 'pending', 'bot')
       GROUP BY tag`,
    ),
    prisma.$queryRawUnsafe<Array<{ agent_id: string; total: bigint }>>(
      `SELECT assigned_to::text AS agent_id, COUNT(*) AS total
       FROM conversations
       WHERE assigned_to IS NOT NULL
         AND status IN ('open', 'active_outbound', 'in_service', 'pending', 'bot')
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
           FROM conversations c
           WHERE c.resolved_at IS NOT NULL
             AND c.resolved_at::date = CURRENT_DATE
         ) AS total_resolved,
         (
           SELECT AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 60.0)
           FROM conversations c
           WHERE c.resolved_at IS NOT NULL
             AND c.resolved_at::date = CURRENT_DATE
         ) AS avg_resolution_minutes,
         (
           SELECT COUNT(*)
           FROM messages m
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
