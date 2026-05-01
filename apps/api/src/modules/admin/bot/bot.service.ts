import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type {
  CreateBotOptionInput,
  UpdateBotMenuInput,
  UpdateBotOptionInput,
} from './bot.schema.js';

type BotDbClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;

interface BotMenuRow {
  id: string;
  is_active: boolean;
  greeting: string;
  footer: string | null;
  invalid_msg: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ConversationBotRow {
  id: string;
  status: string;
  metadata: unknown;
}

export interface BotOption {
  id: string;
  bot_menu_id: string;
  number: number;
  label: string;
  tag: string | null;
  response: string;
  sort_order: number;
  created_at: Date;
}

export interface BotMenu extends BotMenuRow {
  options: BotOption[];
}

export type BotResponse =
  | { type: 'menu'; text: string }
  | { type: 'invalid'; text: string }
  | { type: 'choice'; text: string; option: BotOption };

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

function tableRef(table: string, schemaName?: string | null): string {
  return schemaName ? `${quoteIdent(schemaName)}.${table}` : table;
}

async function getDefaultMenuId(db: BotDbClient = prisma): Promise<string> {
  await ensureBotInfrastructure(db);
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT id FROM bot_menus ORDER BY created_at ASC LIMIT 1',
  );
  return rows[0]!.id;
}

function mapMenu(menu: BotMenuRow, options: BotOption[]): BotMenu {
  return {
    ...menu,
    options,
  };
}

function normalizeOptionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function formatBotMenu(menu: BotMenu): string {
  const greeting = menu.greeting.trim();
  const optionLines = menu.options
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.number - b.number)
    .map((opt) => `${opt.number}. ${opt.label}`)
    .join('\n');
  const footer = menu.footer?.trim();

  return `${greeting}\n\n${optionLines}` + (footer ? `\n\n${footer}` : '');
}

export async function ensureBotInfrastructure(
  db: BotDbClient = prisma,
  schemaName?: string | null,
): Promise<void> {
  const botMenusRef = tableRef('bot_menus', schemaName);
  const botOptionsRef = tableRef('bot_options', schemaName);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${botMenusRef} (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      is_active     BOOLEAN DEFAULT false,
      greeting      TEXT NOT NULL DEFAULT 'Olá! Bem-vindo ao nosso atendimento. Como posso ajudá-lo?',
      footer        TEXT DEFAULT 'Digite o número da opção desejada.',
      invalid_msg   TEXT DEFAULT 'Opção inválida. Por favor, escolha uma das opções abaixo:',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${botOptionsRef} (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bot_menu_id UUID REFERENCES ${botMenusRef}(id) ON DELETE CASCADE,
      number      INTEGER NOT NULL,
      label       VARCHAR(100) NOT NULL,
      tag         VARCHAR(50),
      response    TEXT NOT NULL,
      sort_order  INTEGER DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(bot_menu_id, number)
    )
  `);

  await db.$executeRawUnsafe(`
    INSERT INTO ${botMenusRef} (is_active, greeting, footer)
    SELECT false,
           'Olá! Bem-vindo ao nosso atendimento. Como posso ajudá-lo?',
           'Digite o número da opção desejada.'
    WHERE NOT EXISTS (SELECT 1 FROM ${botMenusRef})
  `);
}

export async function getMenu(db: BotDbClient = prisma): Promise<BotMenu> {
  await ensureBotInfrastructure(db);
  const menuRows = await db.$queryRawUnsafe<BotMenuRow[]>(
    `SELECT id, is_active, greeting, footer, invalid_msg, created_at, updated_at
     FROM bot_menus
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  const menu = menuRows[0];
  if (!menu) throw new NotFoundError('Menu do bot');

  const options = await db.$queryRawUnsafe<BotOption[]>(
    `SELECT id, bot_menu_id, number, label, tag, response, sort_order, created_at
     FROM bot_options
     WHERE bot_menu_id = $1::uuid
     ORDER BY sort_order ASC, number ASC`,
    menu.id,
  );

  return mapMenu(menu, options);
}

export async function updateMenu(data: UpdateBotMenuInput): Promise<BotMenu> {
  const menuId = await getDefaultMenuId();
  await prisma.$queryRawUnsafe(
    `UPDATE bot_menus
     SET is_active = COALESCE($1::boolean, is_active),
         greeting = COALESCE($2::text, greeting),
         footer = COALESCE($3::text, footer),
         invalid_msg = COALESCE($4::text, invalid_msg),
         updated_at = NOW()
     WHERE id = $5::uuid`,
    data.is_active ?? null,
    data.greeting?.trim() ?? null,
    data.footer?.trim() ?? null,
    data.invalid_msg?.trim() ?? null,
    menuId,
  );

  return getMenu();
}

async function ensureOptionNumberAvailable(menuId: string, number: number, excludeId?: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM bot_options
     WHERE bot_menu_id = $1::uuid
       AND number = $2
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     LIMIT 1`,
    menuId,
    number,
    excludeId ?? null,
  );
  if (rows[0]) throw new ConflictError('Já existe uma opção com esse número');
}

export async function addOption(data: CreateBotOptionInput): Promise<BotOption> {
  const menuId = await getDefaultMenuId();
  await ensureOptionNumberAvailable(menuId, data.number);

  const rows = await prisma.$queryRawUnsafe<BotOption[]>(
    `INSERT INTO bot_options (bot_menu_id, number, label, tag, response, sort_order)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     RETURNING id, bot_menu_id, number, label, tag, response, sort_order, created_at`,
    menuId,
    data.number,
    data.label.trim(),
    normalizeOptionalText(data.tag),
    data.response.trim(),
    data.sort_order,
  );

  return rows[0]!;
}

export async function updateOption(id: string, data: UpdateBotOptionInput): Promise<BotOption> {
  await ensureBotInfrastructure();
  const currentRows = await prisma.$queryRawUnsafe<BotOption[]>(
    `SELECT id, bot_menu_id, number, label, tag, response, sort_order, created_at
     FROM bot_options
     WHERE id = $1::uuid
     LIMIT 1`,
    id,
  );
  const current = currentRows[0];
  if (!current) throw new NotFoundError('Opção do bot');

  const nextNumber = data.number ?? current.number;
  if (nextNumber !== current.number) {
    await ensureOptionNumberAvailable(current.bot_menu_id, nextNumber, id);
  }

  const rows = await prisma.$queryRawUnsafe<BotOption[]>(
    `UPDATE bot_options
     SET number = $1,
         label = COALESCE($2::text, label),
         tag = $3,
         response = COALESCE($4::text, response),
         sort_order = COALESCE($5::integer, sort_order)
     WHERE id = $6::uuid
     RETURNING id, bot_menu_id, number, label, tag, response, sort_order, created_at`,
    nextNumber,
    data.label?.trim() ?? null,
    data.tag === undefined ? current.tag : normalizeOptionalText(data.tag),
    data.response?.trim() ?? null,
    data.sort_order ?? null,
    id,
  );

  return rows[0]!;
}

export async function deleteOption(id: string): Promise<BotOption> {
  await ensureBotInfrastructure();
  const rows = await prisma.$queryRawUnsafe<BotOption[]>(
    `DELETE FROM bot_options
     WHERE id = $1::uuid
     RETURNING id, bot_menu_id, number, label, tag, response, sort_order, created_at`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Opção do bot');
  return rows[0];
}

export async function reorderOptions(orderedIds: string[]): Promise<BotMenu> {
  const menuId = await getDefaultMenuId();
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx.$executeRawUnsafe(
        `UPDATE bot_options
         SET sort_order = $1
         WHERE id = $2::uuid
           AND bot_menu_id = $3::uuid`,
        index,
        id,
        menuId,
      );
    }
  });
  return getMenu();
}

async function getActiveMenuForBot(db: BotDbClient, ensureInfrastructure = true): Promise<BotMenu | null> {
  if (ensureInfrastructure) {
    await ensureBotInfrastructure(db);
  }
  const menuRows = await db.$queryRawUnsafe<BotMenuRow[]>(
    `SELECT id, is_active, greeting, footer, invalid_msg, created_at, updated_at
     FROM bot_menus
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  const menu = menuRows[0];
  if (!menu?.is_active) return null;

  const options = await db.$queryRawUnsafe<BotOption[]>(
    `SELECT id, bot_menu_id, number, label, tag, response, sort_order, created_at
     FROM bot_options
     WHERE bot_menu_id = $1::uuid
     ORDER BY sort_order ASC, number ASC`,
    menu.id,
  );

  return mapMenu(menu, options);
}

export async function processBotMessage(
  message: string,
  conversationId: string,
  isNewConversation: boolean,
  db: BotDbClient,
  ensureInfrastructure = true,
): Promise<BotResponse | null> {
  const menu = await getActiveMenuForBot(db, ensureInfrastructure);
  if (!menu) return null;

  const conversationRows = await db.$queryRawUnsafe<ConversationBotRow[]>(
    `SELECT id, status, metadata
     FROM conversations
     WHERE id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  const conversation = conversationRows[0];
  if (!conversation) return null;

  const metadata =
    typeof conversation.metadata === 'object' && conversation.metadata !== null
      ? (conversation.metadata as Record<string, unknown>)
      : {};
  const stage = typeof metadata.bot_stage === 'string' ? metadata.bot_stage : null;

  if (!stage) {
    if (!isNewConversation) return null;
    return { type: 'menu', text: formatBotMenu(menu) };
  }

  if (stage !== 'waiting_choice') return null;

  const choice = Number.parseInt(message.trim(), 10);
  const option = Number.isNaN(choice)
    ? null
    : menu.options.find((item) => item.number === choice) ?? null;

  if (option) {
    return { type: 'choice', option, text: option.response };
  }

  const invalidMessage = menu.invalid_msg?.trim() || 'Opção inválida. Por favor, escolha uma das opções abaixo:';
  return {
    type: 'invalid',
    text: `${invalidMessage}\n\n${formatBotMenu(menu)}`,
  };
}

export async function updateConversationBotStage(
  conversationId: string,
  stage: 'waiting_choice' | 'done',
  tag: string | null,
  db: BotDbClient,
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE conversations
     SET metadata = COALESCE(metadata, '{}'::jsonb)
       || jsonb_build_object('bot_stage', $1::text, 'bot_tag', $2::text)
     WHERE id = $3::uuid`,
    stage,
    tag ?? '',
    conversationId,
  );
}
