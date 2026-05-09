import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { CreateTicketTypeInput, UpdateTicketTypeInput } from './ticket-types.schema.js';

export interface TicketTypeRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  is_active: boolean;
  sort_order: number;
  require_due_date_for_urgent: boolean;
  require_category_for_waiting: boolean;
  created_at: Date;
  updated_at: Date;
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

const initializedSchemas = new Set<string>();

async function ensureTicketTypesInfrastructure(schemaName: string): Promise<void> {
  if (initializedSchemas.has(schemaName)) return;

  const ticketTypesRef = tableRef(schemaName, 'ticket_types');
  const ticketsRef = tableRef(schemaName, 'tickets');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${ticketTypesRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(80) NOT NULL,
      icon VARCHAR(20) NOT NULL DEFAULT '🎫',
      color VARCHAR(7) NOT NULL DEFAULT '#00C9A7',
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      require_due_date_for_urgent BOOLEAN NOT NULL DEFAULT true,
      require_category_for_waiting BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${ticketTypesRef}
    ADD COLUMN IF NOT EXISTS require_due_date_for_urgent BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS require_category_for_waiting BOOLEAN NOT NULL DEFAULT true
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_types_name_unique
    ON ${ticketTypesRef} (LOWER(name))
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${ticketsRef}
    ADD COLUMN IF NOT EXISTS type_id UUID REFERENCES ${ticketTypesRef}(id) ON DELETE SET NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tickets_type_id
    ON ${ticketsRef}(type_id)
  `);

  initializedSchemas.add(schemaName);
}

export async function listTicketTypes(tenantId: string, schemaName?: string): Promise<TicketTypeRow[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureTicketTypesInfrastructure(resolvedSchemaName);

  const ticketTypesRef = tableRef(resolvedSchemaName, 'ticket_types');

  return prisma.$queryRawUnsafe<TicketTypeRow[]>(
    `SELECT id, name, icon, color, is_active, sort_order, require_due_date_for_urgent, require_category_for_waiting, created_at, updated_at
     FROM ${ticketTypesRef}
     ORDER BY is_active DESC, sort_order ASC, name ASC`,
  );
}

export async function createTicketType(
  tenantId: string,
  data: CreateTicketTypeInput,
  schemaName?: string,
): Promise<TicketTypeRow> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureTicketTypesInfrastructure(resolvedSchemaName);

  const ticketTypesRef = tableRef(resolvedSchemaName, 'ticket_types');

  const rows = await prisma.$queryRawUnsafe<TicketTypeRow[]>(
    `INSERT INTO ${ticketTypesRef} (name, icon, color, sort_order, require_due_date_for_urgent, require_category_for_waiting)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, icon, color, is_active, sort_order, require_due_date_for_urgent, require_category_for_waiting, created_at, updated_at`,
    data.name.trim(),
    data.icon?.trim() || '🎫',
    data.color ?? '#00C9A7',
    data.sort_order ?? 0,
    data.require_due_date_for_urgent ?? true,
    data.require_category_for_waiting ?? true,
  );

  return rows[0]!;
}

export async function updateTicketType(
  tenantId: string,
  typeId: string,
  data: UpdateTicketTypeInput,
  schemaName?: string,
): Promise<TicketTypeRow> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureTicketTypesInfrastructure(resolvedSchemaName);

  const ticketTypesRef = tableRef(resolvedSchemaName, 'ticket_types');

  const rows = await prisma.$queryRawUnsafe<TicketTypeRow[]>(
    `UPDATE ${ticketTypesRef}
     SET name = COALESCE($1::text, name),
         icon = COALESCE($2::text, icon),
         color = COALESCE($3::text, color),
         sort_order = COALESCE($4::integer, sort_order),
         is_active = COALESCE($5::boolean, is_active),
         require_due_date_for_urgent = COALESCE($6::boolean, require_due_date_for_urgent),
         require_category_for_waiting = COALESCE($7::boolean, require_category_for_waiting),
         updated_at = NOW()
     WHERE id = $8::uuid
     RETURNING id, name, icon, color, is_active, sort_order, require_due_date_for_urgent, require_category_for_waiting, created_at, updated_at`,
    data.name?.trim() ?? null,
    data.icon?.trim() ?? null,
    data.color ?? null,
    data.sort_order ?? null,
    data.is_active ?? null,
    data.require_due_date_for_urgent ?? null,
    data.require_category_for_waiting ?? null,
    typeId,
  );

  if (!rows[0]) throw new NotFoundError('Tipo de ticket nao encontrado');
  return rows[0];
}

export async function deactivateTicketType(
  tenantId: string,
  typeId: string,
  schemaName?: string,
): Promise<TicketTypeRow> {
  return updateTicketType(tenantId, typeId, { is_active: false }, schemaName);
}
