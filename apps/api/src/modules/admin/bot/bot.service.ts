import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type {
  CreateBotOptionInput,
  CreateBotSubOptionInput,
  UpdateBotMenuInput,
  UpdateBotOptionInput,
} from './bot.schema.js';

type BotDbClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;
type BotOptionSkillInput = { skill_id: string; required?: boolean };

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

interface RawBotOptionRow {
  id: string;
  bot_menu_id: string;
  number: number;
  label: string;
  tag: string | null;
  response: string | null;
  has_submenu: boolean;
  submenu_greeting: string | null;
  parent_option_id: string | null;
  sort_order: number;
  department_id: string | null;
  department_name: string | null;
  created_at: Date;
}

export interface BotOption extends RawBotOptionRow {
  children?: BotOption[];
}

export interface BotMenu extends BotMenuRow {
  options: BotOption[];
}

export type BotResponse =
  | {
    type: 'menu';
    text: string;
    options: Array<Pick<BotOption, 'number' | 'label'>>;
    includeBack: boolean;
  }
  | {
    type: 'submenu';
    text: string;
    option: BotOption;
    options: Array<Pick<BotOption, 'number' | 'label'>>;
    includeBack: true;
  }
  | {
    type: 'invalid';
    text: string;
    options: Array<Pick<BotOption, 'number' | 'label'>>;
    includeBack: boolean;
  }
  | { type: 'choice'; text: string; option: BotOption | null };

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} nao encontrado`);
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

function normalizeOptionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeOption(row: RawBotOptionRow): BotOption {
  return {
    ...row,
    response: row.response ?? null,
    tag: row.tag ?? null,
    submenu_greeting: row.submenu_greeting ?? null,
    parent_option_id: row.parent_option_id ?? null,
    has_submenu: row.has_submenu === true,
    children: [],
  };
}

function buildOptionTree(rows: RawBotOptionRow[]): BotOption[] {
  const options = rows.map(normalizeOption);
  const byParent = new Map<string, BotOption[]>();

  for (const option of options) {
    const key = option.parent_option_id ?? '__root__';
    const list = byParent.get(key) ?? [];
    list.push(option);
    byParent.set(key, list);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.number - b.number);
  }

  const attachChildren = (parentId: string | null): BotOption[] => {
    const key = parentId ?? '__root__';
    const nodes = byParent.get(key) ?? [];

    return nodes.map((node) => ({
      ...node,
      children: attachChildren(node.id),
    }));
  };

  return attachChildren(null);
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

export function buildMenuText(
  greeting: string,
  options: Array<Pick<BotOption, 'number' | 'label'>>,
  footer?: string | null,
  includeBack = false,
): string {
  const lines = [
    greeting,
    '',
    ...options
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((option) => `${option.number}. ${option.label}`),
  ];

  if (includeBack) {
    lines.push('0. Voltar');
  }

  if (footer?.trim()) {
    lines.push('', footer.trim());
  }

  return lines.join('\n');
}

export function formatBotMenu(menu: BotMenu): string {
  return buildMenuText(menu.greeting.trim(), menu.options, menu.footer, false);
}

async function getFlatOptionsByMenuId(db: BotDbClient, menuId: string): Promise<RawBotOptionRow[]> {
  return db.$queryRawUnsafe<RawBotOptionRow[]>(
    `SELECT bo.id, bo.bot_menu_id, bo.number, bo.label, bo.tag, bo.response, bo.has_submenu,
            bo.submenu_greeting, bo.parent_option_id, bo.sort_order,
            NULL::uuid AS department_id, NULL::text AS department_name, bo.created_at
     FROM bot_options bo
     WHERE bo.bot_menu_id = $1::uuid
     ORDER BY bo.sort_order ASC, bo.number ASC`,
    menuId,
  );
}

async function getOptionsByParent(
  db: BotDbClient,
  menuId: string,
  parentId: string | null,
): Promise<BotOption[]> {
  const rows = await db.$queryRawUnsafe<RawBotOptionRow[]>(
    `SELECT bo.id, bo.bot_menu_id, bo.number, bo.label, bo.tag, bo.response, bo.has_submenu,
            bo.submenu_greeting, bo.parent_option_id, bo.sort_order,
            NULL::uuid AS department_id, NULL::text AS department_name, bo.created_at
     FROM bot_options bo
     WHERE bo.bot_menu_id = $1::uuid
       AND (($2::uuid IS NULL AND bo.parent_option_id IS NULL) OR bo.parent_option_id = $2::uuid)
     ORDER BY bo.sort_order ASC, bo.number ASC`,
    menuId,
    parentId,
  );

  return rows.map(normalizeOption);
}

async function getOptionById(db: BotDbClient, optionId: string): Promise<BotOption | null> {
  const rows = await db.$queryRawUnsafe<RawBotOptionRow[]>(
    `SELECT bo.id, bo.bot_menu_id, bo.number, bo.label, bo.tag, bo.response, bo.has_submenu,
            bo.submenu_greeting, bo.parent_option_id, bo.sort_order,
            NULL::uuid AS department_id, NULL::text AS department_name, bo.created_at
     FROM bot_options bo
     WHERE bo.id = $1::uuid
     LIMIT 1`,
    optionId,
  );

  return rows[0] ? normalizeOption(rows[0]) : null;
}

async function assertParentOption(db: BotDbClient, menuId: string, parentOptionId: string): Promise<void> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM bot_options
     WHERE id = $1::uuid
       AND bot_menu_id = $2::uuid
     LIMIT 1`,
    parentOptionId,
    menuId,
  );

  if (!rows[0]) {
    throw new NotFoundError('Opcao pai');
  }
}

async function ensureOptionNumberAvailable(
  menuId: string,
  parentOptionId: string | null,
  number: number,
  excludeId?: string,
) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM bot_options
     WHERE bot_menu_id = $1::uuid
       AND (($2::uuid IS NULL AND parent_option_id IS NULL) OR parent_option_id = $2::uuid)
       AND number = $3
       AND ($4::uuid IS NULL OR id <> $4::uuid)
     LIMIT 1`,
    menuId,
    parentOptionId,
    number,
    excludeId ?? null,
  );

  if (rows[0]) {
    throw new ConflictError('Ja existe uma opcao com esse numero neste nivel');
  }
}

async function ensureBotOptionSkillsInfrastructure(db: BotDbClient = prisma): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS skills (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      description TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_skills_name"
    ON skills(name)
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bot_option_skills (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bot_option_id UUID NOT NULL REFERENCES bot_options(id) ON DELETE CASCADE,
      skill_id      UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      required      BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(bot_option_id, skill_id)
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_bot_option_skills_option"
    ON bot_option_skills(bot_option_id)
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_bot_option_skills_skill"
    ON bot_option_skills(skill_id)
  `);
}

async function syncBotOptionSkills(
  botOptionId: string,
  skills?: BotOptionSkillInput[],
  db: BotDbClient = prisma,
): Promise<void> {
  if (skills === undefined) return;

  await ensureBotOptionSkillsInfrastructure(db);
  await db.$executeRawUnsafe('DELETE FROM bot_option_skills WHERE bot_option_id = $1::uuid', botOptionId);

  const deduped = new Map(skills.map((skill) => [skill.skill_id, skill.required ?? true]));
  for (const [skillId, required] of deduped.entries()) {
    await db.$executeRawUnsafe(
      `INSERT INTO bot_option_skills (bot_option_id, skill_id, required)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (bot_option_id, skill_id)
       DO UPDATE SET required = EXCLUDED.required`,
      botOptionId,
      skillId,
      required,
    );
  }
}

export async function ensureBotInfrastructure(
  db: BotDbClient = prisma,
  schemaName?: string | null,
): Promise<void> {
  const botMenusRef = tableRef('bot_menus', schemaName);
  const botOptionsRef = tableRef('bot_options', schemaName);
  const conversationsRef = tableRef('conversations', schemaName);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${botMenusRef} (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      is_active     BOOLEAN DEFAULT false,
      greeting      TEXT NOT NULL DEFAULT 'Ola! Bem-vindo ao nosso atendimento. Como posso ajuda-lo?',
      footer        TEXT DEFAULT 'Digite o numero da opcao desejada.',
      invalid_msg   TEXT DEFAULT 'Opcao invalida. Por favor, escolha uma das opcoes abaixo:',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${botOptionsRef} (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bot_menu_id      UUID REFERENCES ${botMenusRef}(id) ON DELETE CASCADE,
      number           INTEGER NOT NULL,
      label            VARCHAR(100) NOT NULL,
      tag              VARCHAR(50),
      response         TEXT,
      has_submenu      BOOLEAN NOT NULL DEFAULT false,
      submenu_greeting TEXT,
      parent_option_id UUID REFERENCES ${botOptionsRef}(id) ON DELETE CASCADE,
      sort_order       INTEGER DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE ${botOptionsRef}
    ADD COLUMN IF NOT EXISTS has_submenu BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS submenu_greeting TEXT,
    ADD COLUMN IF NOT EXISTS parent_option_id UUID REFERENCES ${botOptionsRef}(id) ON DELETE CASCADE
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE ${botOptionsRef}
    DROP CONSTRAINT IF EXISTS bot_options_bot_menu_id_number_key
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_bot_options_parent
    ON ${botOptionsRef}(parent_option_id)
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_options_unique_parent_number
    ON ${botOptionsRef}(
      bot_menu_id,
      COALESCE(parent_option_id, '00000000-0000-0000-0000-000000000000'::uuid),
      number
    )
  `);

  await db.$executeRawUnsafe(`
    INSERT INTO ${botMenusRef} (is_active, greeting, footer)
    SELECT false,
           'Ola! Bem-vindo ao nosso atendimento. Como posso ajuda-lo?',
           'Digite o numero da opcao desejada.'
    WHERE NOT EXISTS (SELECT 1 FROM ${botMenusRef})
  `);

  const conversationTableName = schemaName
    ? `${schemaName}.conversations`
    : 'conversations';
  const conversationTableRows = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    conversationTableName,
  );

  if (conversationTableRows[0]?.exists) {
    await db.$executeRawUnsafe(`
      ALTER TABLE ${conversationsRef}
      ADD COLUMN IF NOT EXISTS bot_option_id UUID
      REFERENCES ${botOptionsRef}(id) ON DELETE SET NULL
    `);

    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_conversations_bot_option_id
      ON ${conversationsRef}(bot_option_id)
      WHERE bot_option_id IS NOT NULL
    `);
  }
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

  const rows = await getFlatOptionsByMenuId(db, menu.id);
  const options = buildOptionTree(rows);

  return mapMenu(menu, options);
}

export async function getOptionWithChildren(id: string, db: BotDbClient = prisma): Promise<BotOption> {
  await ensureBotInfrastructure(db);

  const option = await getOptionById(db, id);
  if (!option) throw new NotFoundError('Opcao do bot');

  const rows = await getFlatOptionsByMenuId(db, option.bot_menu_id);
  const tree = buildOptionTree(rows);

  const walk = (nodes: BotOption[]): BotOption | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = walk(node.children ?? []);
      if (found) return found;
    }
    return null;
  };

  const found = walk(tree);
  if (!found) throw new NotFoundError('Opcao do bot');

  return found;
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

export async function addOption(data: CreateBotOptionInput): Promise<BotOption> {
  const menuId = await getDefaultMenuId();
  const parentOptionId = data.parent_option_id ?? null;

  if (parentOptionId) {
    await assertParentOption(prisma, menuId, parentOptionId);
  }

  await ensureOptionNumberAvailable(menuId, parentOptionId, data.number);

  const hasSubmenu = data.has_submenu === true;
  const response = hasSubmenu
    ? normalizeOptionalText(data.response)
    : (normalizeOptionalText(data.response) ?? 'Transferindo para um atendente. Aguarde...');

  const rows = await prisma.$queryRawUnsafe<RawBotOptionRow[]>(
    `INSERT INTO bot_options (
       bot_menu_id,
       parent_option_id,
       number,
       label,
       tag,
       response,
       has_submenu,
       submenu_greeting,
       sort_order
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, bot_menu_id, number, label, tag, response, has_submenu, submenu_greeting,
               parent_option_id, sort_order, NULL::uuid AS department_id, NULL::text AS department_name, created_at`,
    menuId,
    parentOptionId,
    data.number,
    data.label.trim(),
    normalizeOptionalText(data.tag),
    response,
    hasSubmenu,
    normalizeOptionalText(data.submenu_greeting),
    data.sort_order,
  );

  const option = normalizeOption(rows[0]!);
  await syncBotOptionSkills(option.id, data.skills);
  return option;
}

export async function addSubOption(parentId: string, data: CreateBotSubOptionInput): Promise<BotOption> {
  const parent = await getOptionById(prisma, parentId);
  if (!parent) throw new NotFoundError('Opcao pai');

  return addOption({
    ...data,
    parent_option_id: parent.id,
  });
}

export async function updateOption(id: string, data: UpdateBotOptionInput): Promise<BotOption> {
  await ensureBotInfrastructure();

  const current = await getOptionById(prisma, id);
  if (!current) throw new NotFoundError('Opcao do bot');

  const nextParentOptionId = data.parent_option_id ?? current.parent_option_id;

  if (nextParentOptionId === id) {
    throw new ConflictError('Uma opcao nao pode ser pai dela mesma');
  }

  if (nextParentOptionId) {
    await assertParentOption(prisma, current.bot_menu_id, nextParentOptionId);
  }

  const nextNumber = data.number ?? current.number;
  await ensureOptionNumberAvailable(current.bot_menu_id, nextParentOptionId, nextNumber, id);

  const nextHasSubmenu = data.has_submenu ?? current.has_submenu;
  const responseCandidate = data.response === undefined
    ? current.response
    : normalizeOptionalText(data.response);

  if (!nextHasSubmenu && !responseCandidate) {
    throw new ConflictError('Resposta e obrigatoria para opcoes sem submenu');
  }

  const rows = await prisma.$queryRawUnsafe<RawBotOptionRow[]>(
    `UPDATE bot_options
     SET number = $1,
         label = COALESCE($2::text, label),
         tag = $3,
         response = $4,
         has_submenu = $5,
         submenu_greeting = $6,
         parent_option_id = $7::uuid,
         sort_order = COALESCE($8::integer, sort_order)
     WHERE id = $9::uuid
     RETURNING id, bot_menu_id, number, label, tag, response, has_submenu, submenu_greeting,
               parent_option_id, sort_order, NULL::uuid AS department_id, NULL::text AS department_name, created_at`,
    nextNumber,
    data.label?.trim() ?? null,
    data.tag === undefined ? current.tag : normalizeOptionalText(data.tag),
    responseCandidate,
    nextHasSubmenu,
    data.submenu_greeting === undefined
      ? current.submenu_greeting
      : normalizeOptionalText(data.submenu_greeting),
    nextParentOptionId,
    data.sort_order ?? null,
    id,
  );

  const option = normalizeOption(rows[0]!);
  await syncBotOptionSkills(option.id, data.skills);
  return option;
}

export async function deleteOption(id: string): Promise<BotOption> {
  await ensureBotInfrastructure();

  const rows = await prisma.$queryRawUnsafe<RawBotOptionRow[]>(
    `DELETE FROM bot_options
     WHERE id = $1::uuid
     RETURNING id, bot_menu_id, number, label, tag, response, has_submenu, submenu_greeting,
               parent_option_id, sort_order, NULL::uuid AS department_id, NULL::text AS department_name, created_at`,
    id,
  );

  if (!rows[0]) throw new NotFoundError('Opcao do bot');
  return normalizeOption(rows[0]);
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

  const rows = await getFlatOptionsByMenuId(db, menu.id);
  const tree = buildOptionTree(rows);

  return mapMenu(menu, tree);
}

async function updateBotMetadata(
  conversationId: string,
  patch: Record<string, unknown>,
  db: BotDbClient,
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE conversations
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
     WHERE id = $2::uuid`,
    JSON.stringify(patch),
    conversationId,
  );
}

async function handleTransferToAgent(
  conversationId: string,
  option: BotOption | null,
  db: BotDbClient,
): Promise<BotResponse> {
  const responseText = option?.response?.trim() || 'Transferindo para um atendente. Aguarde...';
  const parentOption = option?.parent_option_id ? await getOptionById(db, option.parent_option_id) : null;
  const botGroup = parentOption?.label ?? option?.label ?? null;
  const botSubject = option?.label ?? option?.tag ?? null;

  await updateBotMetadata(
    conversationId,
    {
      bot_stage: 'done',
      bot_option_id: option?.id ?? null,
      bot_group: botGroup,
      bot_subject: botSubject,
      bot_tag: botSubject,
      bot_path: [],
      bot_current_parent: null,
      bot_current_menu_text: null,
    },
    db,
  );

  await db.$executeRawUnsafe(
    `UPDATE conversations
     SET status = 'open',
         queue_entered_at = COALESCE(queue_entered_at, NOW()),
         bot_option_id = $1::uuid,
         metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object(
             'bot_option_id', $1::uuid,
             'bot_tag', $3::text,
             'bot_group', $2::text,
             'bot_subject', $3::text
           )
     WHERE id = $4::uuid`,
    option?.id ?? null,
    botGroup ?? '',
    botSubject ?? '',
    conversationId,
  );

  return { type: 'choice', text: responseText, option };
}

function normalizePath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

export async function processBotMessage(
  message: string,
  conversationId: string,
  isNewConversation: boolean,
  db: BotDbClient,
  ensureInfrastructure = true,
  interactiveReplyId: string | null = null,
): Promise<BotResponse | null> {
  const menu = await getActiveMenuForBot(db, ensureInfrastructure);
  if (!menu?.is_active) return null;

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

  const botStage = typeof metadata['bot_stage'] === 'string' ? metadata['bot_stage'] : null;
  const currentParentId = typeof metadata['bot_current_parent'] === 'string'
    ? metadata['bot_current_parent']
    : null;
  const path = normalizePath(metadata['bot_path']);

  if (!botStage || (isNewConversation && !botStage)) {
    const rootOptions = await getOptionsByParent(db, menu.id, null);
    const menuText = buildMenuText(menu.greeting, rootOptions, menu.footer);

    await updateBotMetadata(
      conversationId,
      {
        bot_stage: 'waiting_choice',
        bot_path: [],
        bot_current_parent: null,
        bot_current_menu_text: menuText,
      },
      db,
    );

    return {
      type: 'menu',
      text: menuText,
      options: rootOptions.map((option) => ({ number: option.number, label: option.label })),
      includeBack: false,
    };
  }

  if (botStage !== 'waiting_choice') {
    return null;
  }

  const input = interactiveReplyId?.trim() || message.trim();

  if (input === '0') {
    if (path.length === 0) {
      return handleTransferToAgent(conversationId, null, db);
    }

    const newPath = path.slice(0, -1);
    const newParentId = newPath.length > 0 ? newPath[newPath.length - 1]! : null;
    const parentOptions = await getOptionsByParent(db, menu.id, newParentId);
    const parentOption = newParentId ? await getOptionById(db, newParentId) : null;

    const greeting = parentOption?.submenu_greeting?.trim() || menu.greeting;
    const menuText = buildMenuText(greeting, parentOptions, menu.footer, newParentId !== null);

    await updateBotMetadata(
      conversationId,
      {
        bot_stage: 'waiting_choice',
        bot_path: newPath,
        bot_current_parent: newParentId,
        bot_current_menu_text: menuText,
      },
      db,
    );

    return {
      type: 'menu',
      text: menuText,
      options: parentOptions.map((option) => ({ number: option.number, label: option.label })),
      includeBack: newParentId !== null,
    };
  }

  const options = await getOptionsByParent(db, menu.id, currentParentId);
  const choiceNum = Number.parseInt(input, 10);

  if (Number.isNaN(choiceNum)) {
    const currentMenuText =
      (typeof metadata['bot_current_menu_text'] === 'string' && metadata['bot_current_menu_text'])
        ? metadata['bot_current_menu_text']
        : buildMenuText(menu.greeting, options, menu.footer, currentParentId !== null);

    return {
      type: 'invalid',
      text: `${menu.invalid_msg ?? 'Opcao invalida'}\n\n${currentMenuText}`,
      options: options.map((option) => ({ number: option.number, label: option.label })),
      includeBack: currentParentId !== null,
    };
  }

  const selectedOption = options.find((option) => option.number === choiceNum);

  if (!selectedOption) {
    const currentMenuText =
      (typeof metadata['bot_current_menu_text'] === 'string' && metadata['bot_current_menu_text'])
        ? metadata['bot_current_menu_text']
        : buildMenuText(menu.greeting, options, menu.footer, currentParentId !== null);

    return {
      type: 'invalid',
      text: `${menu.invalid_msg ?? 'Opcao invalida'}\n\n${currentMenuText}`,
      options: options.map((option) => ({ number: option.number, label: option.label })),
      includeBack: currentParentId !== null,
    };
  }

  if (selectedOption.has_submenu) {
    const subOptions = await getOptionsByParent(db, menu.id, selectedOption.id);
    const subGreeting = selectedOption.submenu_greeting?.trim()
      || `*${selectedOption.label}* — escolha uma opção:`;

    const menuText = buildMenuText(subGreeting, subOptions, menu.footer, true);
    const newPath = [...path, selectedOption.id];

    await updateBotMetadata(
      conversationId,
      {
        bot_stage: 'waiting_choice',
        bot_path: newPath,
        bot_current_parent: selectedOption.id,
        bot_current_menu_text: menuText,
      },
      db,
    );

    return {
      type: 'submenu',
      text: menuText,
      option: selectedOption,
      options: subOptions.map((option) => ({ number: option.number, label: option.label })),
      includeBack: true,
    };
  }

  return handleTransferToAgent(conversationId, selectedOption, db);
}

export async function updateConversationBotStage(
  conversationId: string,
  stage: 'waiting_choice' | 'done',
  tag: string | null,
  db: BotDbClient,
): Promise<void> {
  await updateBotMetadata(
    conversationId,
    {
      bot_stage: stage,
      bot_tag: tag ?? '',
    },
    db,
  );
}
