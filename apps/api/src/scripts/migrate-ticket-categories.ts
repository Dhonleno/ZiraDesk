import { prisma } from '../config/database.js';

async function ensureTicketCategoriesTable(schemaName: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${schemaName}".ticket_categories (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      description TEXT,
      color       VARCHAR(7),
      is_active   BOOLEAN NOT NULL DEFAULT true,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
      await ensureTicketCategoriesTable(tenant.schema_name);
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
    console.error('Falha ao migrar ticket_categories:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
