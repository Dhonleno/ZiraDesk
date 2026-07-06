import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { CreateTicketCategoryInput, UpdateTicketCategoryInput } from './ticket-categories.schema.js';

export interface TicketCategoryRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_active: boolean;
  sort_order: number;
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

const initializedSchemas = new Set<string>();

export async function ensureTicketCategoriesInfrastructure(schemaName: string): Promise<void> {
  if (initializedSchemas.has(schemaName)) return;

  const ref = tableRef(schemaName, 'ticket_categories');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${ref} (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      description TEXT,
      color       VARCHAR(7),
      is_active   BOOLEAN NOT NULL DEFAULT true,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  initializedSchemas.add(schemaName);
}

export async function listTicketCategories(schemaName: string): Promise<TicketCategoryRow[]> {
  await ensureTicketCategoriesInfrastructure(schemaName);
  const ref = tableRef(schemaName, 'ticket_categories');

  return prisma.$queryRawUnsafe<TicketCategoryRow[]>(
    `SELECT id, name, description, color, is_active, sort_order, created_at, updated_at
     FROM ${ref}
     ORDER BY is_active DESC, sort_order ASC, name ASC`,
  );
}

export async function createTicketCategory(
  data: CreateTicketCategoryInput,
  schemaName: string,
): Promise<TicketCategoryRow> {
  await ensureTicketCategoriesInfrastructure(schemaName);
  const ref = tableRef(schemaName, 'ticket_categories');

  const rows = await prisma.$queryRawUnsafe<TicketCategoryRow[]>(
    `INSERT INTO ${ref} (name, description, color, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, description, color, is_active, sort_order, created_at, updated_at`,
    data.name.trim(),
    data.description?.trim() ?? null,
    data.color ?? null,
    data.is_active ?? true,
    data.sort_order ?? 0,
  );

  return rows[0]!;
}

export async function updateTicketCategory(
  id: string,
  data: UpdateTicketCategoryInput,
  schemaName: string,
): Promise<TicketCategoryRow> {
  await ensureTicketCategoriesInfrastructure(schemaName);
  const ref = tableRef(schemaName, 'ticket_categories');

  const rows = await prisma.$queryRawUnsafe<TicketCategoryRow[]>(
    `UPDATE ${ref}
     SET name        = COALESCE($1::text, name),
         description = CASE WHEN $2::boolean THEN $3::text ELSE description END,
         color       = CASE WHEN $4::boolean THEN $5::varchar ELSE color END,
         is_active   = COALESCE($6::boolean, is_active),
         sort_order  = COALESCE($7::integer, sort_order),
         updated_at  = NOW()
     WHERE id = $8::uuid
     RETURNING id, name, description, color, is_active, sort_order, created_at, updated_at`,
    data.name?.trim() ?? null,
    Object.prototype.hasOwnProperty.call(data, 'description'),
    data.description?.trim() ?? null,
    Object.prototype.hasOwnProperty.call(data, 'color'),
    data.color ?? null,
    data.is_active ?? null,
    data.sort_order ?? null,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Categoria não encontrada');
  return rows[0];
}

export async function deleteTicketCategory(
  id: string,
  schemaName: string,
): Promise<TicketCategoryRow> {
  await ensureTicketCategoriesInfrastructure(schemaName);
  const categoriesRef = tableRef(schemaName, 'ticket_categories');
  const ticketsRef    = tableRef(schemaName, 'tickets');

  const usageRows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM ${ticketsRef} WHERE category = (SELECT name FROM ${categoriesRef} WHERE id = $1::uuid)`,
    id,
  );

  const usageCount = Number(usageRows[0]?.count ?? 0);
  if (usageCount > 0) {
    throw new ConflictError('Esta categoria está em uso por tickets existentes');
  }

  const rows = await prisma.$queryRawUnsafe<TicketCategoryRow[]>(
    `DELETE FROM ${categoriesRef} WHERE id = $1::uuid
     RETURNING id, name, description, color, is_active, sort_order, created_at, updated_at`,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Categoria não encontrada');
  return rows[0];
}
