import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database.js';
import { seedCloseConfig } from '../../../database/seeds/closeConfig.seed.js';
import type {
  CreateCloseOutcomeInput,
  CreateCloseTypeInput,
  ReorderCloseConfigInput,
  UpdateCloseOutcomeInput,
  UpdateCloseTypeInput,
} from './close-config.schema.js';

export interface CloseConfigItem {
  id: string;
  label: string;
  isDefault: boolean;
  isActive: boolean;
  order: number;
  createdAt: Date;
}

export interface CloseConfigSelectItem {
  id: string;
  label: string;
}

export interface ActiveCloseConfigResult {
  types: CloseConfigSelectItem[];
  outcomes: CloseConfigSelectItem[];
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

type CloseConfigRow = {
  id: string;
  label: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
};

type CloseConfigSelectRow = {
  id: string;
  label: string;
};

type CountRow = {
  count: number;
};

const initializedSchemas = new Set<string>();
const seededSchemas = new Set<string>();

function validateSchemaName(schema: string): string {
  if (!/^[a-z0-9_]+$/.test(schema)) {
    throw new ConflictError('Schema do tenant invalido');
  }

  return schema;
}

function mapCloseConfigRow(row: CloseConfigRow): CloseConfigItem {
  return {
    id: row.id,
    label: row.label,
    isDefault: row.is_default,
    isActive: row.is_active,
    order: row.sort_order,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const maybeError = error as {
    code?: string;
    message?: string;
    meta?: { code?: string; message?: string };
  };

  if (maybeError.code === 'P2002') return true;
  if (maybeError.meta?.code === '23505') return true;

  return (maybeError.message ?? '').toLowerCase().includes('duplicate key value violates unique constraint');
}

async function resolveSchemaName(tenantId: string, schemaName?: string): Promise<string> {
  if (schemaName) return validateSchemaName(schemaName);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });

  if (!tenant) throw new NotFoundError('Tenant nao encontrado');
  return validateSchemaName(tenant.schemaName);
}

async function runWithTenantSchema<T>(
  schemaName: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const safeSchemaName = validateSchemaName(schemaName);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);
    return callback(tx);
  });
}

async function fetchCloseConfigRows(
  tx: Prisma.TransactionClient,
  tableName: 'conversation_close_types' | 'conversation_close_outcomes',
  onlyActive: boolean,
): Promise<CloseConfigRow[]> {
  const whereClause = onlyActive ? 'WHERE is_active = true' : '';

  return tx.$queryRawUnsafe<CloseConfigRow[]>(
    `SELECT id, label, is_default, is_active, sort_order, created_at
     FROM ${tableName}
     ${whereClause}
     ORDER BY sort_order ASC, label ASC`,
  );
}

async function fetchCloseConfigSelectRows(
  tx: Prisma.TransactionClient,
  tableName: 'conversation_close_types' | 'conversation_close_outcomes',
): Promise<CloseConfigSelectItem[]> {
  const rows = await tx.$queryRawUnsafe<CloseConfigSelectRow[]>(
    `SELECT id, label
     FROM ${tableName}
     WHERE is_active = true
     ORDER BY sort_order ASC, label ASC`,
  );

  return rows.map((row) => ({ id: row.id, label: row.label }));
}

async function countRowsById(
  tx: Prisma.TransactionClient,
  tableName: 'conversation_close_types' | 'conversation_close_outcomes',
  ids: ReadonlyArray<string>,
): Promise<number> {
  const rows = await tx.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*)::int AS count
     FROM ${tableName}
     WHERE id = ANY($1::text[])`,
    ids,
  );

  return rows[0]?.count ?? 0;
}

async function countConversationUsage(
  tx: Prisma.TransactionClient,
  fieldName: 'close_type_id' | 'close_outcome_id',
  id: string,
): Promise<number> {
  const rows = await tx.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*)::int AS count
     FROM conversations
     WHERE ${fieldName} = $1::text`,
    id,
  );

  return rows[0]?.count ?? 0;
}

export async function ensureCloseConfigInfrastructure(schemaName: string): Promise<void> {
  const safeSchemaName = validateSchemaName(schemaName);
  if (initializedSchemas.has(safeSchemaName)) return;

  await runWithTenantSchema(safeSchemaName, async (tx) => {
    await tx.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS conversation_close_types (
      id         VARCHAR(30)  PRIMARY KEY,
      label      VARCHAR(120) NOT NULL UNIQUE,
      is_default BOOLEAN      NOT NULL DEFAULT false,
      is_active  BOOLEAN      NOT NULL DEFAULT true,
      sort_order INTEGER      NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

    await tx.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS conversation_close_outcomes (
      id         VARCHAR(30)  PRIMARY KEY,
      label      VARCHAR(160) NOT NULL UNIQUE,
      is_default BOOLEAN      NOT NULL DEFAULT false,
      is_active  BOOLEAN      NOT NULL DEFAULT true,
      sort_order INTEGER      NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

    await tx.$executeRawUnsafe(`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS close_type_id VARCHAR(30)
  `);

    await tx.$executeRawUnsafe(`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS close_outcome_id VARCHAR(30)
  `);

    await tx.$executeRawUnsafe(`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ
  `);

    await tx.$executeRawUnsafe(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE conversations
        ADD CONSTRAINT conversations_close_type_id_fkey
          FOREIGN KEY (close_type_id)
          REFERENCES conversation_close_types(id)
          ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;
    END $$;
  `);

    await tx.$executeRawUnsafe(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE conversations
        ADD CONSTRAINT conversations_close_outcome_id_fkey
          FOREIGN KEY (close_outcome_id)
          REFERENCES conversation_close_outcomes(id)
          ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;
    END $$;
  `);

    await tx.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_conversations_close_type
    ON conversations(close_type_id)
  `);

    await tx.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_conversations_close_outcome
    ON conversations(close_outcome_id)
  `);
  });

  initializedSchemas.add(safeSchemaName);
}

async function ensureCloseConfigSeeded(schemaName: string): Promise<void> {
  const safeSchemaName = validateSchemaName(schemaName);
  if (seededSchemas.has(safeSchemaName)) return;

  await seedCloseConfig(prisma, safeSchemaName);
  seededSchemas.add(safeSchemaName);
}

async function ensureCloseConfigReady(schemaName: string): Promise<void> {
  await ensureCloseConfigInfrastructure(schemaName);
  await ensureCloseConfigSeeded(schemaName);
}

export async function listCloseTypes(tenantId: string, schemaName?: string): Promise<CloseConfigItem[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  return runWithTenantSchema(resolvedSchemaName, async (tx) => {
    const rows = await fetchCloseConfigRows(tx, 'conversation_close_types', false);
    return rows.map(mapCloseConfigRow);
  });
}

export async function listCloseOutcomes(tenantId: string, schemaName?: string): Promise<CloseConfigItem[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  return runWithTenantSchema(resolvedSchemaName, async (tx) => {
    const rows = await fetchCloseConfigRows(tx, 'conversation_close_outcomes', false);
    return rows.map(mapCloseConfigRow);
  });
}

export async function createCloseType(
  tenantId: string,
  data: CreateCloseTypeInput,
  schemaName?: string,
): Promise<CloseConfigItem> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  try {
    return await runWithTenantSchema(resolvedSchemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<CloseConfigRow[]>(
        `INSERT INTO conversation_close_types (id, label, is_default, is_active, sort_order)
         VALUES ('c' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 24), $1, false, $2, $3)
         RETURNING id, label, is_default, is_active, sort_order, created_at`,
        data.label.trim(),
        data.isActive ?? true,
        data.order ?? 0,
      );

      const created = rows[0];
      if (!created) throw new ConflictError('Falha ao criar tipo de encerramento');
      return mapCloseConfigRow(created);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Ja existe um tipo de encerramento com este nome');
    }
    throw error;
  }
}

export async function createCloseOutcome(
  tenantId: string,
  data: CreateCloseOutcomeInput,
  schemaName?: string,
): Promise<CloseConfigItem> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  try {
    return await runWithTenantSchema(resolvedSchemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<CloseConfigRow[]>(
        `INSERT INTO conversation_close_outcomes (id, label, is_default, is_active, sort_order)
         VALUES ('c' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 24), $1, false, $2, $3)
         RETURNING id, label, is_default, is_active, sort_order, created_at`,
        data.label.trim(),
        data.isActive ?? true,
        data.order ?? 0,
      );

      const created = rows[0];
      if (!created) throw new ConflictError('Falha ao criar desfecho');
      return mapCloseConfigRow(created);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Ja existe um desfecho com este nome');
    }
    throw error;
  }
}

export async function updateCloseType(
  tenantId: string,
  id: string,
  data: UpdateCloseTypeInput,
  schemaName?: string,
): Promise<CloseConfigItem> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  try {
    return await runWithTenantSchema(resolvedSchemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<CloseConfigRow[]>(
        `UPDATE conversation_close_types
         SET label = COALESCE($2, label),
             is_active = COALESCE($3, is_active),
             sort_order = COALESCE($4, sort_order)
         WHERE id = $1
         RETURNING id, label, is_default, is_active, sort_order, created_at`,
        id,
        data.label?.trim() ?? null,
        data.isActive ?? null,
        data.order ?? null,
      );

      const updated = rows[0];
      if (!updated) throw new NotFoundError('Tipo de encerramento nao encontrado');
      return mapCloseConfigRow(updated);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Ja existe um tipo de encerramento com este nome');
    }
    throw error;
  }
}

export async function updateCloseOutcome(
  tenantId: string,
  id: string,
  data: UpdateCloseOutcomeInput,
  schemaName?: string,
): Promise<CloseConfigItem> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  try {
    return await runWithTenantSchema(resolvedSchemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<CloseConfigRow[]>(
        `UPDATE conversation_close_outcomes
         SET label = COALESCE($2, label),
             is_active = COALESCE($3, is_active),
             sort_order = COALESCE($4, sort_order)
         WHERE id = $1
         RETURNING id, label, is_default, is_active, sort_order, created_at`,
        id,
        data.label?.trim() ?? null,
        data.isActive ?? null,
        data.order ?? null,
      );

      const updated = rows[0];
      if (!updated) throw new NotFoundError('Desfecho nao encontrado');
      return mapCloseConfigRow(updated);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Ja existe um desfecho com este nome');
    }
    throw error;
  }
}

export async function deleteCloseType(tenantId: string, id: string, schemaName?: string): Promise<CloseConfigItem> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  return runWithTenantSchema(resolvedSchemaName, async (tx) => {
    const existingRows = await tx.$queryRawUnsafe<CloseConfigRow[]>(
      `SELECT id, label, is_default, is_active, sort_order, created_at
       FROM conversation_close_types
       WHERE id = $1
       LIMIT 1`,
      id,
    );

    if (!existingRows[0]) throw new NotFoundError('Tipo de encerramento nao encontrado');

    const usageCount = await countConversationUsage(tx, 'close_type_id', id);
    if (usageCount > 0) {
      throw new ConflictError('Nao e possivel excluir o tipo: existem conversas vinculadas');
    }

    const rows = await tx.$queryRawUnsafe<CloseConfigRow[]>(
      `UPDATE conversation_close_types
       SET is_active = false
       WHERE id = $1
       RETURNING id, label, is_default, is_active, sort_order, created_at`,
      id,
    );

    const deleted = rows[0];
    if (!deleted) throw new NotFoundError('Tipo de encerramento nao encontrado');
    return mapCloseConfigRow(deleted);
  });
}

export async function deleteCloseOutcome(tenantId: string, id: string, schemaName?: string): Promise<CloseConfigItem> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  return runWithTenantSchema(resolvedSchemaName, async (tx) => {
    const existingRows = await tx.$queryRawUnsafe<CloseConfigRow[]>(
      `SELECT id, label, is_default, is_active, sort_order, created_at
       FROM conversation_close_outcomes
       WHERE id = $1
       LIMIT 1`,
      id,
    );

    if (!existingRows[0]) throw new NotFoundError('Desfecho nao encontrado');

    const usageCount = await countConversationUsage(tx, 'close_outcome_id', id);
    if (usageCount > 0) {
      throw new ConflictError('Nao e possivel excluir o desfecho: existem conversas vinculadas');
    }

    const rows = await tx.$queryRawUnsafe<CloseConfigRow[]>(
      `UPDATE conversation_close_outcomes
       SET is_active = false
       WHERE id = $1
       RETURNING id, label, is_default, is_active, sort_order, created_at`,
      id,
    );

    const deleted = rows[0];
    if (!deleted) throw new NotFoundError('Desfecho nao encontrado');
    return mapCloseConfigRow(deleted);
  });
}

export async function reorderCloseTypes(
  tenantId: string,
  payload: ReorderCloseConfigInput,
  schemaName?: string,
): Promise<CloseConfigItem[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  return runWithTenantSchema(resolvedSchemaName, async (tx) => {
    const totalFound = await countRowsById(tx, 'conversation_close_types', payload.ids);
    if (totalFound !== payload.ids.length) {
      throw new NotFoundError('Um ou mais tipos de encerramento nao foram encontrados');
    }

    for (const [index, id] of payload.ids.entries()) {
      await tx.$executeRawUnsafe(
        `UPDATE conversation_close_types
         SET sort_order = $2
         WHERE id = $1`,
        id,
        index,
      );
    }

    const rows = await fetchCloseConfigRows(tx, 'conversation_close_types', false);
    return rows.map(mapCloseConfigRow);
  });
}

export async function reorderCloseOutcomes(
  tenantId: string,
  payload: ReorderCloseConfigInput,
  schemaName?: string,
): Promise<CloseConfigItem[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  return runWithTenantSchema(resolvedSchemaName, async (tx) => {
    const totalFound = await countRowsById(tx, 'conversation_close_outcomes', payload.ids);
    if (totalFound !== payload.ids.length) {
      throw new NotFoundError('Um ou mais desfechos nao foram encontrados');
    }

    for (const [index, id] of payload.ids.entries()) {
      await tx.$executeRawUnsafe(
        `UPDATE conversation_close_outcomes
         SET sort_order = $2
         WHERE id = $1`,
        id,
        index,
      );
    }

    const rows = await fetchCloseConfigRows(tx, 'conversation_close_outcomes', false);
    return rows.map(mapCloseConfigRow);
  });
}

export async function listActiveCloseConfig(
  tenantId: string,
  schemaName?: string,
): Promise<ActiveCloseConfigResult> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureCloseConfigReady(resolvedSchemaName);

  return runWithTenantSchema(resolvedSchemaName, async (tx) => {
    const [types, outcomes] = await Promise.all([
      fetchCloseConfigSelectRows(tx, 'conversation_close_types'),
      fetchCloseConfigSelectRows(tx, 'conversation_close_outcomes'),
    ]);

    return { types, outcomes };
  });
}
