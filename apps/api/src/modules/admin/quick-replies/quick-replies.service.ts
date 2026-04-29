import { prisma } from '../../../config/database.js';
import type {
  CreateQuickReplyInput,
  ListQuickRepliesQuery,
  UpdateQuickReplyInput,
} from './quick-replies.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface QuickReplyRow {
  id: string;
  title: string;
  shortcut: string;
  content: string;
  category: string;
  created_at: Date;
  updated_at: Date;
}

function normalizeShortcut(shortcut: string) {
  return shortcut.trim().replace(/^\/+/, '').toLowerCase();
}

async function ensureQuickRepliesTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS quick_replies (
      id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      title       VARCHAR(120) NOT NULL,
      shortcut    VARCHAR(50)  NOT NULL UNIQUE,
      content     TEXT         NOT NULL,
      category    VARCHAR(30)  NOT NULL DEFAULT 'other',
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureShortcutAvailable(shortcut: string, excludeId?: string) {
  await ensureQuickRepliesTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
       FROM quick_replies
      WHERE shortcut = $1
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT 1`,
    shortcut,
    excludeId ?? null,
  );

  if (rows[0]) {
    throw new ConflictError('Já existe uma resposta rápida com esse atalho');
  }
}

export async function listQuickReplies(query: ListQuickRepliesQuery) {
  await ensureQuickRepliesTable();
  const filters: string[] = [];
  const params: Array<string | null> = [];

  if (query.search) {
    params.push(`%${query.search.toLowerCase()}%`);
    const idx = params.length;
    filters.push(`(
      LOWER(title) LIKE $${idx}
      OR LOWER(shortcut) LIKE $${idx}
      OR LOWER(content) LIKE $${idx}
    )`);
  }

  if (query.category) {
    params.push(query.category);
    filters.push(`category = $${params.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe<QuickReplyRow[]>(
    `SELECT id, title, shortcut, content, category, created_at, updated_at
       FROM quick_replies
       ${whereClause}
      ORDER BY title ASC`,
    ...params,
  );
  return rows;
}

export async function createQuickReply(data: CreateQuickReplyInput) {
  await ensureQuickRepliesTable();
  const shortcut = normalizeShortcut(data.shortcut);
  await ensureShortcutAvailable(shortcut);

  const rows = await prisma.$queryRawUnsafe<QuickReplyRow[]>(
    `INSERT INTO quick_replies (title, shortcut, content, category)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, shortcut, content, category, created_at, updated_at`,
    data.title.trim(),
    shortcut,
    data.content.trim(),
    data.category,
  );

  return rows[0]!;
}

export async function updateQuickReply(id: string, data: UpdateQuickReplyInput) {
  await ensureQuickRepliesTable();
  const currentRows = await prisma.$queryRawUnsafe<QuickReplyRow[]>(
    `SELECT id, title, shortcut, content, category, created_at, updated_at
       FROM quick_replies
      WHERE id = $1
      LIMIT 1`,
    id,
  );

  const current = currentRows[0];
  if (!current) throw new NotFoundError('Resposta rápida');

  const nextShortcut = data.shortcut ? normalizeShortcut(data.shortcut) : current.shortcut;
  if (nextShortcut !== current.shortcut) {
    await ensureShortcutAvailable(nextShortcut, id);
  }

  const rows = await prisma.$queryRawUnsafe<QuickReplyRow[]>(
    `UPDATE quick_replies
        SET title = COALESCE($1, title),
            shortcut = $2,
            content = COALESCE($3, content),
            category = COALESCE($4, category),
            updated_at = NOW()
      WHERE id = $5
      RETURNING id, title, shortcut, content, category, created_at, updated_at`,
    data.title?.trim() ?? null,
    nextShortcut,
    data.content?.trim() ?? null,
    data.category ?? null,
    id,
  );

  return rows[0]!;
}

export async function deleteQuickReply(id: string) {
  await ensureQuickRepliesTable();
  const rows = await prisma.$queryRawUnsafe<QuickReplyRow[]>(
    `DELETE FROM quick_replies
      WHERE id = $1
      RETURNING id, title, shortcut, content, category, created_at, updated_at`,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Resposta rápida');
  return rows[0];
}
