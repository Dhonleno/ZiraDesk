import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { CreateTagInput, UpdateTagInput } from './conversation-tags.schema.js';

export interface ConversationTagRow {
  id: string;
  name: string;
  color: string;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
}

export interface ConversationAssignedTagRow extends ConversationTagRow {
  assigned_by: string | null;
  assigned_at: Date;
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

const DEFAULT_TAGS: Array<{ name: string; color: string; sort_order: number }> = [
  { name: 'Urgente', color: '#EF4444', sort_order: 1 },
  { name: 'VIP', color: '#F59E0B', sort_order: 2 },
  { name: 'Aguardando cliente', color: '#3B82F6', sort_order: 3 },
  { name: 'Proposta enviada', color: '#8B5CF6', sort_order: 4 },
  { name: 'Bug', color: '#EC4899', sort_order: 5 },
  { name: 'Resolvido', color: '#10B981', sort_order: 6 },
];

const initializedSchemas = new Set<string>();

export async function ensureConversationTagsInfrastructure(schemaName: string): Promise<void> {
  if (initializedSchemas.has(schemaName)) return;

  const conversationTagsRef = tableRef(schemaName, 'conversation_tags');
  const conversationTagAssignmentsRef = tableRef(schemaName, 'conversation_tag_assignments');
  const conversationsRef = tableRef(schemaName, 'conversations');
  const usersRef = tableRef(schemaName, 'users');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${conversationTagsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(50) NOT NULL,
      color VARCHAR(7) NOT NULL DEFAULT '#00C9A7',
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(name)
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${conversationTagsRef}
    ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#00C9A7',
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${conversationTagAssignmentsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES ${conversationsRef}(id) ON DELETE CASCADE,
      tag_id UUID REFERENCES ${conversationTagsRef}(id) ON DELETE CASCADE,
      assigned_by UUID REFERENCES ${usersRef}(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(conversation_id, tag_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${conversationTagAssignmentsRef}
    ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES ${usersRef}(id),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_tag_assignments_conv ON ${conversationTagAssignmentsRef}(conversation_id)`,
  );

  for (const tag of DEFAULT_TAGS) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${conversationTagsRef} (name, color, sort_order)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1
         FROM ${conversationTagsRef}
         WHERE LOWER(name) = LOWER($1)
       )`,
      tag.name,
      tag.color,
      tag.sort_order,
    );
  }

  initializedSchemas.add(schemaName);
}

export async function listTags(tenantId: string, schemaName?: string): Promise<ConversationTagRow[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureConversationTagsInfrastructure(resolvedSchemaName);

  const conversationTagsRef = tableRef(resolvedSchemaName, 'conversation_tags');
  return prisma.$queryRawUnsafe<ConversationTagRow[]>(
    `SELECT id, name, color, is_active, sort_order, created_at
     FROM ${conversationTagsRef}
     WHERE is_active = true
     ORDER BY sort_order ASC, name ASC`,
  );
}

export async function createTag(
  tenantId: string,
  data: CreateTagInput,
  schemaName?: string,
): Promise<ConversationTagRow> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureConversationTagsInfrastructure(resolvedSchemaName);

  const conversationTagsRef = tableRef(resolvedSchemaName, 'conversation_tags');

  try {
    const rows = await prisma.$queryRawUnsafe<ConversationTagRow[]>(
      `INSERT INTO ${conversationTagsRef} (name, color, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, name, color, is_active, sort_order, created_at`,
      data.name.trim(),
      data.color,
      data.sort_order ?? 0,
    );

    return rows[0]!;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      error.message.includes('duplicate key value')
    ) {
      throw new ConflictError('Ja existe uma etiqueta com esse nome');
    }
    throw error;
  }
}

export async function updateTag(
  tenantId: string,
  tagId: string,
  data: UpdateTagInput,
  schemaName?: string,
): Promise<ConversationTagRow> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureConversationTagsInfrastructure(resolvedSchemaName);

  const conversationTagsRef = tableRef(resolvedSchemaName, 'conversation_tags');

  try {
    const rows = await prisma.$queryRawUnsafe<ConversationTagRow[]>(
      `UPDATE ${conversationTagsRef}
       SET name = COALESCE($1::text, name),
           color = COALESCE($2::text, color),
           sort_order = COALESCE($3::integer, sort_order),
           is_active = COALESCE($4::boolean, is_active)
       WHERE id = $5::uuid
       RETURNING id, name, color, is_active, sort_order, created_at`,
      data.name?.trim() ?? null,
      data.color ?? null,
      data.sort_order ?? null,
      data.is_active ?? null,
      tagId,
    );

    if (!rows[0]) throw new NotFoundError('Etiqueta nao encontrada');
    return rows[0];
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      error.message.includes('duplicate key value')
    ) {
      throw new ConflictError('Ja existe uma etiqueta com esse nome');
    }
    throw error;
  }
}

export async function deleteTag(tenantId: string, tagId: string, schemaName?: string): Promise<ConversationTagRow> {
  return updateTag(tenantId, tagId, { is_active: false }, schemaName);
}

export async function getConversationTags(
  tenantId: string,
  conversationId: string,
  schemaName?: string,
): Promise<ConversationAssignedTagRow[]> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureConversationTagsInfrastructure(resolvedSchemaName);

  const conversationTagsRef = tableRef(resolvedSchemaName, 'conversation_tags');
  const conversationTagAssignmentsRef = tableRef(resolvedSchemaName, 'conversation_tag_assignments');

  return prisma.$queryRawUnsafe<ConversationAssignedTagRow[]>(
    `SELECT
       ct.id,
       ct.name,
       ct.color,
       ct.is_active,
       ct.sort_order,
       ct.created_at,
       cta.assigned_by,
       cta.created_at AS assigned_at
     FROM ${conversationTagsRef} ct
     JOIN ${conversationTagAssignmentsRef} cta ON cta.tag_id = ct.id
     WHERE cta.conversation_id = $1::uuid
     ORDER BY ct.sort_order ASC, ct.name ASC`,
    conversationId,
  );
}

export async function addTagToConversation(
  tenantId: string,
  conversationId: string,
  tagId: string,
  userId: string,
  schemaName?: string,
): Promise<void> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureConversationTagsInfrastructure(resolvedSchemaName);

  const conversationTagsRef = tableRef(resolvedSchemaName, 'conversation_tags');
  const conversationTagAssignmentsRef = tableRef(resolvedSchemaName, 'conversation_tag_assignments');

  const tagRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${conversationTagsRef}
     WHERE id = $1::uuid
       AND is_active = true
     LIMIT 1`,
    tagId,
  );

  if (!tagRows[0]) throw new NotFoundError('Etiqueta nao encontrada');

  await prisma.$queryRawUnsafe(
    `INSERT INTO ${conversationTagAssignmentsRef} (conversation_id, tag_id, assigned_by)
     VALUES ($1::uuid, $2::uuid, $3::uuid)
     ON CONFLICT (conversation_id, tag_id) DO NOTHING`,
    conversationId,
    tagId,
    userId,
  );
}

export async function removeTagFromConversation(
  tenantId: string,
  conversationId: string,
  tagId: string,
  schemaName?: string,
): Promise<{ removed: boolean }> {
  const resolvedSchemaName = await resolveSchemaName(tenantId, schemaName);
  await ensureConversationTagsInfrastructure(resolvedSchemaName);

  const conversationTagAssignmentsRef = tableRef(resolvedSchemaName, 'conversation_tag_assignments');

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `DELETE FROM ${conversationTagAssignmentsRef}
     WHERE conversation_id = $1::uuid
       AND tag_id = $2::uuid
     RETURNING id`,
    conversationId,
    tagId,
  );

  return { removed: Boolean(rows[0]) };
}
