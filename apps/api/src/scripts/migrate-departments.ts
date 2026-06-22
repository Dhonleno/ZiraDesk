import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

type MigrationResult = {
  schemaName: string;
  migrated: boolean;
  backfilled: number;
};

async function migrateSchema(schemaName: string): Promise<MigrationResult> {
  const schema = quoteIdent(schemaName);

  const tableRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.conversations`,
  );

  if (!tableRows[0]?.exists) {
    console.log(`IGNORADO ${schemaName} (tabela conversations ausente)`);
    return { schemaName, migrated: false, backfilled: 0 };
  }

  const usersRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.users`,
  );

  if (!usersRows[0]?.exists) {
    console.log(`IGNORADO ${schemaName} (tabela users ausente)`);
    return { schemaName, migrated: false, backfilled: 0 };
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.departments (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      description TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.agent_departments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
      department_id UUID NOT NULL REFERENCES ${schema}.departments(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, department_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_agent_departments_user
      ON ${schema}.agent_departments(user_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_agent_departments_department
      ON ${schema}.agent_departments(department_id)
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.bot_options
      ADD COLUMN IF NOT EXISTS department_id UUID
      REFERENCES ${schema}.departments(id) ON DELETE SET NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_bot_options_department
      ON ${schema}.bot_options(department_id)
      WHERE department_id IS NOT NULL
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.conversations
      ADD COLUMN IF NOT EXISTS department_id UUID
      REFERENCES ${schema}.departments(id) ON DELETE SET NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_conversations_department
      ON ${schema}.conversations(department_id)
      WHERE department_id IS NOT NULL
  `);

  const backfilledRows = await prisma.$queryRawUnsafe<Array<{ updated_count: bigint }>>(`
    WITH updated AS (
      UPDATE ${schema}.conversations c
      SET department_id = bo.department_id
      FROM ${schema}.bot_options bo
      WHERE c.bot_option_id = bo.id
        AND c.department_id IS NULL
        AND bo.department_id IS NOT NULL
      RETURNING 1
    )
    SELECT COUNT(*) AS updated_count FROM updated
  `);

  return { schemaName, migrated: true, backfilled: Number(backfilledRows[0]?.updated_count ?? 0n) };
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

  console.log(`Migrando departamentos em ${tenants.length} tenants...`);

  let failures = 0;
  let migrated = 0;
  const results: MigrationResult[] = [];

  for (const tenant of tenants) {
    try {
      const result = await migrateSchema(tenant.schema_name);
      results.push(result);
      if (result.migrated) {
        migrated += 1;
        console.log(`OK ${tenant.schema_name}: backfill=${result.backfilled}`);
      }
    } catch (err) {
      failures += 1;
      console.error(`ERRO ${tenant.schema_name}:`, err);
    }
  }

  const totalBackfilled = results.filter((r) => r.migrated).reduce((sum, r) => sum + r.backfilled, 0);
  console.log(`Concluído. Migrados=${migrated} Backfill=${totalBackfilled} Erros=${failures}.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Falha ao migrar departamentos:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
