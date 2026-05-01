import { prisma } from '../../config/database.js';
import type { Server } from 'socket.io';
import { ensureAgentAssignmentsInfrastructure, autoAssignNextQueuedConversation } from './conversations/auto-assign.service.js';
import { quoteIdent } from './conversations/protocols.js';
import type { StartPauseInput } from './pause.schema.js';

interface PauseStatusRow {
  user_id: string;
  status: string;
  pause_reason: string | null;
  pause_started_at: Date | null;
  pause_notes: string | null;
  is_available: boolean;
  duration_seconds: number;
}

export interface PauseStatusResponse {
  status: 'online' | 'paused' | 'offline';
  pause_reason: string | null;
  pause_started_at: string | null;
  pause_notes: string | null;
  duration_seconds: number;
  is_available: boolean;
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

function mapPauseStatus(row?: PauseStatusRow): PauseStatusResponse {
  if (!row) {
    return {
      status: 'online',
      pause_reason: null,
      pause_started_at: null,
      pause_notes: null,
      duration_seconds: 0,
      is_available: true,
    };
  }

  const normalizedStatus = row.status === 'paused' || row.status === 'offline' ? row.status : 'online';

  return {
    status: normalizedStatus,
    pause_reason: row.pause_reason,
    pause_started_at: row.pause_started_at ? row.pause_started_at.toISOString() : null,
    pause_notes: row.pause_notes,
    duration_seconds: row.duration_seconds,
    is_available: row.is_available,
  };
}

async function queryPauseStatus(
  schemaName: string,
  userId: string,
): Promise<PauseStatusRow | undefined> {
  const assignmentsRef = tableRef(schemaName, 'agent_assignments');

  const rows = await prisma.$queryRawUnsafe<PauseStatusRow[]>(
    `SELECT
       user_id,
       status,
       pause_reason,
       pause_started_at,
       pause_notes,
       is_available,
       CASE
         WHEN pause_started_at IS NULL THEN 0
         ELSE EXTRACT(EPOCH FROM (NOW() - pause_started_at))::integer
       END AS duration_seconds
     FROM ${assignmentsRef}
     WHERE user_id = $1::uuid
     LIMIT 1`,
    userId,
  );

  return rows[0];
}

export async function getPauseStatus(
  tenantId: string,
  userId: string,
  schemaName?: string,
): Promise<PauseStatusResponse> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);

  const row = await queryPauseStatus(resolvedSchemaName, userId);
  return mapPauseStatus(row);
}

export async function startPause(
  tenantId: string,
  userId: string,
  input: StartPauseInput,
  io: Server,
  schemaName?: string,
): Promise<PauseStatusResponse> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);

  const usersRef = tableRef(resolvedSchemaName, 'users');
  const assignmentsRef = tableRef(resolvedSchemaName, 'agent_assignments');
  const historyRef = tableRef(resolvedSchemaName, 'agent_pause_history');
  const normalizedReason = input.reason.trim();
  if (!normalizedReason) {
    throw new ConflictError('Motivo de pausa invalido');
  }

  const userRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${usersRef}
     WHERE id = $1::uuid
       AND status = 'active'
     LIMIT 1`,
    userId,
  );

  if (!userRows[0]) throw new NotFoundError('Usuario nao encontrado ou inativo');

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${assignmentsRef} (user_id)
     VALUES ($1::uuid)
     ON CONFLICT (user_id) DO NOTHING`,
    userId,
  );

  const current = await queryPauseStatus(resolvedSchemaName, userId);
  if (current?.status === 'paused') {
    throw new ConflictError('Agente ja esta em pausa');
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${assignmentsRef}
     SET status = 'paused',
         pause_reason = $1,
         pause_started_at = NOW(),
         pause_notes = $2,
         is_available = false
     WHERE user_id = $3::uuid`,
    normalizedReason,
    input.notes?.trim() ?? null,
    userId,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${historyRef}
     SET ended_at = NOW(),
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::integer
     WHERE user_id = $1::uuid
       AND ended_at IS NULL`,
    userId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${historyRef} (user_id, pause_reason, started_at)
     VALUES ($1::uuid, $2, NOW())`,
    userId,
    normalizedReason,
  );

  const status = await getPauseStatus(tenantId, userId, resolvedSchemaName);

  io.to(`tenant:${tenantId}`).emit('agent:paused', {
    userId,
    reason: status.pause_reason,
    startedAt: status.pause_started_at,
    status: 'paused',
  });

  return status;
}

export async function endPause(
  tenantId: string,
  userId: string,
  io: Server,
  schemaName?: string,
): Promise<PauseStatusResponse> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);

  const assignmentsRef = tableRef(resolvedSchemaName, 'agent_assignments');
  const historyRef = tableRef(resolvedSchemaName, 'agent_pause_history');

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${assignmentsRef} (user_id)
     VALUES ($1::uuid)
     ON CONFLICT (user_id) DO NOTHING`,
    userId,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${assignmentsRef}
     SET status = 'online',
         pause_reason = NULL,
         pause_started_at = NULL,
         pause_notes = NULL,
         is_available = true
     WHERE user_id = $1::uuid`,
    userId,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${historyRef}
     SET ended_at = NOW(),
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::integer
     WHERE user_id = $1::uuid
       AND ended_at IS NULL`,
    userId,
  );

  io.to(`tenant:${tenantId}`).emit('agent:resumed', {
    userId,
    status: 'online',
    resumedAt: new Date().toISOString(),
  });

  await autoAssignNextQueuedConversation(tenantId, resolvedSchemaName, prisma, io, userId);

  return getPauseStatus(tenantId, userId, resolvedSchemaName);
}
