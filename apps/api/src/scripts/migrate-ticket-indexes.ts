import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

type MigrationResult = {
  schemaName: string;
  migrated: boolean;
};

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
    CREATE INDEX IF NOT EXISTS idx_tickets_status
    ON ${schema}.tickets(status)
    WHERE status NOT IN ('closed', 'resolved')
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to
    ON ${schema}.tickets(assigned_to)
    WHERE assigned_to IS NOT NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tickets_created_at
    ON ${schema}.tickets(created_at DESC)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tickets_department_status
    ON ${schema}.tickets(department_id, status)
    WHERE department_id IS NOT NULL
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

  console.log(`Criando índices de tickets em ${tenants.length} tenants...`);

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
    console.error('Falha ao criar índices de tickets:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
