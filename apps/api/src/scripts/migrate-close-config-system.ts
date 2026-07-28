import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';
import {
  SYSTEM_CLOSE_OUTCOMES,
  SYSTEM_CLOSE_TYPES,
} from '../database/seeds/closeConfig.seed.js';

type SystemSeedItem = {
  id: string;
  label: string;
  order: number;
};

type MigrationResult = {
  schemaName: string;
  migrated: boolean;
  insertedTypes: number;
  insertedOutcomes: number;
  missingIds: string[];
};

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.${tableName}`,
  );

  return rows[0]?.exists === true;
}

async function insertSystemRecords(
  tableRef: string,
  items: ReadonlyArray<SystemSeedItem>,
): Promise<number> {
  const params: unknown[] = [];
  const values: string[] = [];

  for (const [index, item] of items.entries()) {
    const base = index * 3;
    values.push(`($${base + 1}, $${base + 2}, false, true, true, $${base + 3})`);
    params.push(item.id, item.label, item.order);
  }

  // ON CONFLICT sem alvo cobre a PK (id) e o UNIQUE (label): rodar de novo nao
  // duplica, e um label ja ocupado por registro do admin nao aborta a migration.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO ${tableRef} (id, label, is_default, is_active, is_system, sort_order)
     VALUES ${values.join(', ')}
     ON CONFLICT DO NOTHING
     RETURNING id`,
    ...params,
  );

  return rows.length;
}

async function findMissingIds(
  tableRef: string,
  items: ReadonlyArray<SystemSeedItem>,
): Promise<string[]> {
  const expectedIds = items.map((item) => item.id);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${tableRef}
     WHERE id = ANY($1::text[])`,
    expectedIds,
  );

  const present = new Set(rows.map((row) => row.id));
  return expectedIds.filter((id) => !present.has(id));
}

async function migrateSchema(schemaName: string): Promise<MigrationResult> {
  const schema = quoteIdent(schemaName);
  const typesRef = `${schema}.conversation_close_types`;
  const outcomesRef = `${schema}.conversation_close_outcomes`;

  const [hasTypes, hasOutcomes] = await Promise.all([
    tableExists(schemaName, 'conversation_close_types'),
    tableExists(schemaName, 'conversation_close_outcomes'),
  ]);

  if (!hasTypes || !hasOutcomes) {
    console.log(`IGNORADO ${schemaName} (tabelas de close-config ausentes)`);
    return {
      schemaName,
      migrated: false,
      insertedTypes: 0,
      insertedOutcomes: 0,
      missingIds: [],
    };
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${typesRef}
      ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${outcomesRef}
      ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false
  `);

  const insertedTypes = await insertSystemRecords(typesRef, SYSTEM_CLOSE_TYPES);
  const insertedOutcomes = await insertSystemRecords(outcomesRef, SYSTEM_CLOSE_OUTCOMES);

  const missingIds = [
    ...(await findMissingIds(typesRef, SYSTEM_CLOSE_TYPES)),
    ...(await findMissingIds(outcomesRef, SYSTEM_CLOSE_OUTCOMES)),
  ];

  if (missingIds.length > 0) {
    console.warn(
      `AVISO ${schemaName}: registros de sistema ausentes apos o insert (label ja ocupado por registro do admin?): ${missingIds.join(', ')}`,
    );
  }

  return {
    schemaName,
    migrated: true,
    insertedTypes,
    insertedOutcomes,
    missingIds,
  };
}

async function main(): Promise<void> {
  const schemaArg = process.argv.find((arg) => arg.startsWith('--schema='));
  const targetSchema = schemaArg?.slice('--schema='.length);
  const tenants = targetSchema
    ? [{ schema_name: targetSchema }]
    : await prisma.$queryRaw<Array<{ schema_name: string }>>`
        SELECT schema_name
        FROM public.tenants
        WHERE schema_name IS NOT NULL
        ORDER BY created_at ASC
      `;

  console.log(`Migrando is_system de close-config em ${tenants.length} tenants...`);

  let failures = 0;
  const results: MigrationResult[] = [];

  for (const tenant of tenants) {
    try {
      const result = await migrateSchema(tenant.schema_name);
      results.push(result);
      if (result.migrated) {
        console.log(
          `OK ${tenant.schema_name}: tipos=+${result.insertedTypes} desfechos=+${result.insertedOutcomes} ausentes=${result.missingIds.length}`,
        );
      }
    } catch (err) {
      failures += 1;
      console.error(`ERRO ${tenant.schema_name}:`, err);
    }
  }

  const migratedResults = results.filter((result) => result.migrated);
  const totalTypes = migratedResults.reduce((sum, result) => sum + result.insertedTypes, 0);
  const totalOutcomes = migratedResults.reduce((sum, result) => sum + result.insertedOutcomes, 0);
  const totalMissing = migratedResults.reduce((sum, result) => sum + result.missingIds.length, 0);

  console.log(
    `Concluido. tipos=+${totalTypes} desfechos=+${totalOutcomes} ausentes=${totalMissing}.`,
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Falha ao migrar is_system em close-config:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
