import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

type MigrationResult = {
  schemaName: string;
  migrated: boolean;
};

async function migrateSchema(schemaName: string): Promise<MigrationResult> {
  const schema = quoteIdent(schemaName);

  const tableRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.tickets`,
  );

  if (!tableRows[0]?.exists) {
    console.log(`IGNORADO ${schemaName} (tabela tickets ausente)`);
    return { schemaName, migrated: false };
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.ticket_custom_field_definitions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      field_key   VARCHAR(50)  NOT NULL,
      field_type  VARCHAR(20)  NOT NULL,
      options     JSONB        NOT NULL DEFAULT '[]',
      required    BOOLEAN      NOT NULL DEFAULT false,
      visible_in_portal BOOLEAN NOT NULL DEFAULT false,
      sort_order  INTEGER      NOT NULL DEFAULT 0,
      is_active   BOOLEAN      NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_ticket_custom_field_key"
    ON ${schema}.ticket_custom_field_definitions (LOWER(field_key))
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_ticket_custom_field_name"
    ON ${schema}.ticket_custom_field_definitions (LOWER(name))
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

  console.log(`Migrando campos customizados de tickets em ${tenants.length} tenants...`);

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
    console.error('Falha ao migrar campos customizados:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
