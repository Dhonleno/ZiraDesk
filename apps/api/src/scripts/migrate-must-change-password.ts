import { prisma } from '../config/database.js';

type TenantRow = { id: string; slug: string; schema_name: string };

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: string | null }>>(
    `SELECT to_regclass($1)::text AS exists`,
    `${schemaName}.${tableName}`,
  );
  return Boolean(rows[0]?.exists);
}

async function run() {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, slug, schema_name FROM public.tenants ORDER BY created_at ASC`,
  );

  let migrated = 0;
  for (const tenant of tenants) {
    const schemaName = tenant.schema_name;
    if (!(await tableExists(schemaName, 'users'))) {
      console.log(`[${tenant.slug}] schema=${schemaName} sem tabela users, pulando`);
      continue;
    }

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "${schemaName}".users
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false
    `);

    migrated += 1;
    console.log(`[${tenant.slug}] schema=${schemaName} users.must_change_password ok`);
  }

  console.log(`Tenants analisados=${tenants.length} | Schemas migrados=${migrated}`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
