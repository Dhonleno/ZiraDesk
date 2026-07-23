import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { CreateCustomFieldInput, UpdateCustomFieldInput } from './custom-fields.schema.js';

export interface CustomFieldRow {
  id: string;
  name: string;
  field_key: string;
  field_type: string;
  options: unknown;
  required: boolean;
  visible_in_portal: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
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

  if (!tenant) throw new NotFoundError('Tenant não encontrado');
  return tenant.schemaName;
}

const initializedSchemas = new Set<string>();

async function ensureCustomFieldsInfrastructure(schemaName: string): Promise<void> {
  if (initializedSchemas.has(schemaName)) return;

  const ref = tableRef(schemaName, 'ticket_custom_field_definitions');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${ref} (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      field_key   VARCHAR(50)  NOT NULL,
      field_type  VARCHAR(20)  NOT NULL,
      options     JSONB        NOT NULL DEFAULT '[]',
      required    BOOLEAN      NOT NULL DEFAULT false,
      visible_in_portal BOOLEAN NOT NULL DEFAULT false,
      sort_order  INTEGER      NOT NULL DEFAULT 0,
      is_active   BOOLEAN      NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_ticket_custom_field_key"
    ON ${ref} (LOWER(field_key))
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_ticket_custom_field_name"
    ON ${ref} (LOWER(name))
  `);

  initializedSchemas.add(schemaName);
}

const SELECT_COLUMNS =
  'id, name, field_key, field_type, options, required, visible_in_portal, sort_order, is_active, created_at, updated_at';

export async function listCustomFields(tenantId: string, schemaName?: string): Promise<CustomFieldRow[]> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  await ensureCustomFieldsInfrastructure(resolved);
  const ref = tableRef(resolved, 'ticket_custom_field_definitions');

  return prisma.$queryRawUnsafe<CustomFieldRow[]>(
    `SELECT ${SELECT_COLUMNS}
     FROM ${ref}
     ORDER BY is_active DESC, sort_order ASC, name ASC`,
  );
}

export async function createCustomField(
  tenantId: string,
  data: CreateCustomFieldInput,
  schemaName?: string,
): Promise<CustomFieldRow> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  await ensureCustomFieldsInfrastructure(resolved);
  const ref = tableRef(resolved, 'ticket_custom_field_definitions');

  const existing = await prisma.$queryRawUnsafe<Array<{ conflict: string }>>(
    `SELECT
       CASE WHEN LOWER(field_key) = LOWER($1) THEN 'field_key' ELSE 'name' END AS conflict
     FROM ${ref}
     WHERE LOWER(field_key) = LOWER($1) OR LOWER(name) = LOWER($2)
     LIMIT 1`,
    data.field_key,
    data.name,
  );
  if (existing[0]) {
    throw new ConflictError(
      existing[0].conflict === 'field_key'
        ? 'Já existe um campo com esta chave'
        : 'Já existe um campo com este nome',
    );
  }

  const rows = await prisma.$queryRawUnsafe<CustomFieldRow[]>(
    `INSERT INTO ${ref} (name, field_key, field_type, options, required, visible_in_portal, sort_order)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     RETURNING ${SELECT_COLUMNS}`,
    data.name.trim(),
    data.field_key.trim(),
    data.field_type,
    JSON.stringify(data.field_type === 'select' ? data.options : []),
    data.required,
    data.visible_in_portal,
    data.sort_order,
  );

  return rows[0]!;
}

export async function updateCustomField(
  tenantId: string,
  fieldId: string,
  data: UpdateCustomFieldInput,
  schemaName?: string,
): Promise<CustomFieldRow> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  await ensureCustomFieldsInfrastructure(resolved);
  const ref = tableRef(resolved, 'ticket_custom_field_definitions');

  if (data.name !== undefined) {
    const clash = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM ${ref} WHERE LOWER(name) = LOWER($1) AND id <> $2::uuid LIMIT 1`,
      data.name,
      fieldId,
    );
    if (clash[0]) throw new ConflictError('Já existe um campo com este nome');
  }

  const rows = await prisma.$queryRawUnsafe<CustomFieldRow[]>(
    `UPDATE ${ref}
     SET name = COALESCE($1::text, name),
         options = COALESCE($2::jsonb, options),
         required = COALESCE($3::boolean, required),
         visible_in_portal = COALESCE($4::boolean, visible_in_portal),
         sort_order = COALESCE($5::integer, sort_order),
         is_active = COALESCE($6::boolean, is_active),
         updated_at = NOW()
     WHERE id = $7::uuid
     RETURNING ${SELECT_COLUMNS}`,
    data.name?.trim() ?? null,
    data.options !== undefined ? JSON.stringify(data.options) : null,
    data.required ?? null,
    data.visible_in_portal ?? null,
    data.sort_order ?? null,
    data.is_active ?? null,
    fieldId,
  );

  if (!rows[0]) throw new NotFoundError('Campo customizado não encontrado');
  return rows[0];
}

export async function deleteCustomField(
  tenantId: string,
  fieldId: string,
  schemaName?: string,
): Promise<{ deleted: boolean; deactivated: boolean }> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  await ensureCustomFieldsInfrastructure(resolved);
  const ref = tableRef(resolved, 'ticket_custom_field_definitions');
  const ticketsRef = tableRef(resolved, 'tickets');

  const fieldRows = await prisma.$queryRawUnsafe<Array<{ field_key: string }>>(
    `SELECT field_key FROM ${ref} WHERE id = $1::uuid LIMIT 1`,
    fieldId,
  );
  const field = fieldRows[0];
  if (!field) throw new NotFoundError('Campo customizado não encontrado');

  // Soft delete se o campo já foi usado em algum ticket (preserva histórico);
  // hard delete se nunca foi usado.
  const usedRows = await prisma.$queryRawUnsafe<Array<{ used: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM ${ticketsRef} WHERE custom_fields ? $1
     ) AS used`,
    field.field_key,
  );
  const used = Boolean(usedRows[0]?.used);

  if (used) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${ref} SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
      fieldId,
    );
    return { deleted: false, deactivated: true };
  }

  await prisma.$executeRawUnsafe(`DELETE FROM ${ref} WHERE id = $1::uuid`, fieldId);
  return { deleted: true, deactivated: false };
}
