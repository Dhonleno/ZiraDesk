import { prisma } from '../config/database.js';

async function migrateSchema(schemaName: string): Promise<void> {
  const tableRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.conversations`,
  );
  if (!tableRows[0]?.exists) {
    console.log(`IGNORADO ${schemaName} (tabela conversations ausente)`);
    return;
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "${schemaName}".conversations
    ADD COLUMN IF NOT EXISTS bot_option_id UUID
    REFERENCES "${schemaName}".bot_options(id) ON DELETE SET NULL
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "${schemaName}".conversations
    SET bot_option_id = (metadata->>'bot_option_id')::uuid
    WHERE metadata->>'bot_option_id' IS NOT NULL
      AND metadata->>'bot_option_id' != ''
      AND bot_option_id IS NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_conversations_bot_option_id
    ON "${schemaName}".conversations(bot_option_id)
    WHERE bot_option_id IS NOT NULL
  `);
}

async function main(): Promise<void> {
  const tenants = await prisma.$queryRaw<Array<{ schema_name: string }>>`
    SELECT schema_name
    FROM public.tenants
    WHERE status IN ('active', 'trial')
    ORDER BY created_at ASC
  `;

  console.log(`Migrando ${tenants.length} tenants...`);

  let failures = 0;

  for (const tenant of tenants) {
    try {
      await migrateSchema(tenant.schema_name);
      console.log(`OK ${tenant.schema_name}`);
    } catch (err) {
      failures += 1;
      console.error(`ERRO ${tenant.schema_name}:`, err);
    }
  }

  console.log('Concluído.');

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Falha ao migrar bot_option_id em conversations:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
