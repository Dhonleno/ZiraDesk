import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

type CloseConfigSeedInput = {
  label: string;
  order: number;
};

const DEFAULT_CLOSE_TYPES: ReadonlyArray<CloseConfigSeedInput> = [
  { label: 'Dúvida', order: 0 },
  { label: 'Solicitação de serviço', order: 1 },
  { label: 'Consulta de demanda', order: 2 },
  { label: 'Reclamação', order: 3 },
  { label: 'Informação', order: 4 },
  { label: 'Outros', order: 5 },
];

const DEFAULT_CLOSE_OUTCOMES: ReadonlyArray<CloseConfigSeedInput> = [
  { label: 'Resolvido no atendimento', order: 0 },
  { label: 'Demanda aberta', order: 1 },
  { label: 'Transferido para outro setor', order: 2 },
  { label: 'Aguardando retorno do cliente', order: 3 },
  { label: 'Sem resolução', order: 4 },
];

function validateSchemaName(schema: string): string {
  if (!/^[a-z0-9_]+$/.test(schema)) {
    throw new Error('Schema inválido para seed de close config');
  }

  return schema;
}

function generateCuid(): string {
  const timePart = Date.now().toString(36).padStart(8, '0').slice(-8);
  const randomPart = randomBytes(8).toString('hex');
  return `c${timePart}${randomPart}`;
}

function buildBulkInsertQuery(
  tableName: 'conversation_close_types' | 'conversation_close_outcomes',
  items: ReadonlyArray<CloseConfigSeedInput>,
): { query: string; params: ReadonlyArray<unknown> } {
  const params: unknown[] = [];
  const values: string[] = [];

  for (const [index, item] of items.entries()) {
    const base = index * 4;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, true, $${base + 4})`);
    params.push(generateCuid(), item.label, index === 0, item.order);
  }

  const query = `
    INSERT INTO ${tableName} (id, label, is_default, is_active, sort_order)
    VALUES ${values.join(', ')}
    ON CONFLICT (label) DO NOTHING
  `;

  return { query, params };
}

export async function seedCloseConfig(prisma: PrismaClient, schema: string): Promise<void> {
  const safeSchema = validateSchemaName(schema);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchema}", public`);

    const typesInsert = buildBulkInsertQuery('conversation_close_types', DEFAULT_CLOSE_TYPES);
    await tx.$executeRawUnsafe(typesInsert.query, ...typesInsert.params);

    const outcomesInsert = buildBulkInsertQuery('conversation_close_outcomes', DEFAULT_CLOSE_OUTCOMES);
    await tx.$executeRawUnsafe(outcomesInsert.query, ...outcomesInsert.params);
  });
}
