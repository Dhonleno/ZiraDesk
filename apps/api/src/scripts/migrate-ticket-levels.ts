import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

type MigrationResult = {
  schemaName: string;
  migrated: boolean;
};

// Adiciona tickets.level (N1/N2/N3) e o índice parcial correspondente.
// ensureTicketInfrastructure já faz o mesmo de forma lazy; este script existe
// para aplicar de uma vez em todos os tenants, sem depender do primeiro acesso.
async function migrateSchema(schemaName: string): Promise<MigrationResult> {
  const schema = quoteIdent(schemaName);

  const ticketsRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.tickets`,
  );

  if (!ticketsRows[0]?.exists) {
    console.log(`IGNORADO ${schemaName} (tabela tickets ausente)`);
    return { schemaName, migrated: false };
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.tickets
    ADD COLUMN IF NOT EXISTS level VARCHAR(10)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tickets_level
    ON ${schema}.tickets(level)
    WHERE level IS NOT NULL
  `);

  return { schemaName, migrated: true };
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

  console.log(`Adicionando tickets.level em ${tenants.length} tenants...`);

  let failures = 0;
  let migrated = 0;

  for (const tenant of tenants) {
    try {
      const result = await migrateSchema(tenant.schema_name);
      if (result.migrated) {
        migrated += 1;
        console.log(`OK ${tenant.schema_name}`);
      }
    } catch (err) {
      failures += 1;
      console.error(`ERRO ${tenant.schema_name}:`, err);
    }
  }

  console.log(`Concluído. Migrados=${migrated} Erros=${failures}.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Falha ao adicionar tickets.level:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
