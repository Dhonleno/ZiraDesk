import { prisma } from '../../../config/database.js';
import { ensureAgentAssignmentsInfrastructure } from '../../omnichannel/conversations/auto-assign.service.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { CreatePauseReasonInput, UpdatePauseReasonInput } from './pause-reasons.schema.js';

interface PauseReasonRow {
  id: string;
  label: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
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

export async function listPauseReasons(tenantId: string, schemaName?: string): Promise<PauseReasonRow[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);

  const pauseReasonsRef = tableRef(resolvedSchemaName, 'pause_reasons');

  return prisma.$queryRawUnsafe<PauseReasonRow[]>(
    `SELECT id, label, icon, sort_order, is_active, created_at
     FROM ${pauseReasonsRef}
     ORDER BY sort_order ASC, label ASC`,
  );
}

export async function createPauseReason(
  tenantId: string,
  data: CreatePauseReasonInput,
  schemaName?: string,
): Promise<PauseReasonRow> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);

  const pauseReasonsRef = tableRef(resolvedSchemaName, 'pause_reasons');

  const rows = await prisma.$queryRawUnsafe<PauseReasonRow[]>(
    `INSERT INTO ${pauseReasonsRef} (label, icon, sort_order, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id, label, icon, sort_order, is_active, created_at`,
    data.label.trim(),
    data.icon?.trim() || '⏸️',
    data.sort_order ?? 0,
  );

  return rows[0]!;
}

export async function updatePauseReason(
  tenantId: string,
  reasonId: string,
  data: UpdatePauseReasonInput,
  schemaName?: string,
): Promise<PauseReasonRow> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureAgentAssignmentsInfrastructure(prisma, resolvedSchemaName);

  const pauseReasonsRef = tableRef(resolvedSchemaName, 'pause_reasons');

  const rows = await prisma.$queryRawUnsafe<PauseReasonRow[]>(
    `UPDATE ${pauseReasonsRef}
     SET label = COALESCE($1::text, label),
         icon = COALESCE($2::text, icon),
         sort_order = COALESCE($3::integer, sort_order),
         is_active = COALESCE($4::boolean, is_active)
     WHERE id = $5::uuid
     RETURNING id, label, icon, sort_order, is_active, created_at`,
    data.label?.trim() ?? null,
    data.icon?.trim() ?? null,
    data.sort_order ?? null,
    data.is_active ?? null,
    reasonId,
  );

  if (!rows[0]) throw new NotFoundError('Motivo de pausa nao encontrado');

  return rows[0];
}

export async function deactivatePauseReason(
  tenantId: string,
  reasonId: string,
  schemaName?: string,
): Promise<PauseReasonRow> {
  return updatePauseReason(tenantId, reasonId, { is_active: false }, schemaName);
}
