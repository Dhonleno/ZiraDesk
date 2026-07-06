import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { CreateContactTagInput, UpdateContactTagInput } from './contact-tags.schema.js';

export interface ContactTagRow {
  id: string;
  name: string;
  color: string;
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

function contactTagsRef(schemaName: string): string {
  return `${quoteIdent(schemaName)}.contact_tags`;
}

function isDuplicateNameError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as { code?: string }).code === 'P2010'
    && error.message.includes('duplicate key value');
}

export async function listContactTags(schemaName: string): Promise<ContactTagRow[]> {
  return prisma.$queryRawUnsafe<ContactTagRow[]>(
    `SELECT id, name, color, sort_order, created_at, updated_at
     FROM ${contactTagsRef(schemaName)}
     ORDER BY sort_order ASC, name ASC`,
  );
}

export async function createContactTag(
  data: CreateContactTagInput,
  schemaName: string,
): Promise<ContactTagRow> {
  try {
    const rows = await prisma.$queryRawUnsafe<ContactTagRow[]>(
      `INSERT INTO ${contactTagsRef(schemaName)} (name, color, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, name, color, sort_order, created_at, updated_at`,
      data.name,
      data.color,
      data.sort_order,
    );

    return rows[0]!;
  } catch (error) {
    if (isDuplicateNameError(error)) {
      throw new ConflictError('Já existe uma tag de contato com esse nome');
    }
    throw error;
  }
}

export async function updateContactTag(
  id: string,
  data: UpdateContactTagInput,
  schemaName: string,
): Promise<ContactTagRow> {
  try {
    const rows = await prisma.$queryRawUnsafe<ContactTagRow[]>(
      `UPDATE ${contactTagsRef(schemaName)}
       SET name = COALESCE($1::text, name),
           color = COALESCE($2::text, color),
           sort_order = COALESCE($3::integer, sort_order),
           updated_at = NOW()
       WHERE id = $4::uuid
       RETURNING id, name, color, sort_order, created_at, updated_at`,
      data.name ?? null,
      data.color ?? null,
      data.sort_order ?? null,
      id,
    );

    if (!rows[0]) throw new NotFoundError('Tag de contato não encontrada');
    return rows[0];
  } catch (error) {
    if (isDuplicateNameError(error)) {
      throw new ConflictError('Já existe uma tag de contato com esse nome');
    }
    throw error;
  }
}

export async function deleteContactTag(id: string, schemaName: string): Promise<ContactTagRow> {
  const rows = await prisma.$queryRawUnsafe<ContactTagRow[]>(
    `DELETE FROM ${contactTagsRef(schemaName)}
     WHERE id = $1::uuid
     RETURNING id, name, color, sort_order, created_at, updated_at`,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Tag de contato não encontrada');
  return rows[0];
}
