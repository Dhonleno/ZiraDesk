// Execução: docker compose run --rm api-migrate \
//   ./apps/api/node_modules/.bin/tsx \
//   apps/api/src/scripts/migrate-skills-v2.ts

import { prisma } from '../config/database.js';
import { ensureSkillsInfrastructure } from '../modules/admin/skills/skills.infrastructure.js';

type MigrationResult = {
  schemaName: string;
  migrated: boolean;
};

async function migrateSchema(schemaName: string): Promise<MigrationResult> {
  const requiredTables = ['users', 'bot_options'];

  for (const table of requiredTables) {
    const tableRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      'SELECT to_regclass($1::text) IS NOT NULL AS exists',
      `${schemaName}.${table}`,
    );

    if (!tableRows[0]?.exists) {
      console.log(`IGNORADO ${schemaName} (tabela ${table} ausente)`);
      return { schemaName, migrated: false };
    }
  }

  await ensureSkillsInfrastructure(prisma, schemaName);
  return { schemaName, migrated: true };
}

export async function main(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { slug: true, schemaName: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Migrando skills v2 em ${tenants.length} tenants...`);

  let failures = 0;
  let migrated = 0;

  for (const tenant of tenants) {
    try {
      const result = await migrateSchema(tenant.schemaName);
      if (result.migrated) {
        migrated += 1;
        console.log(`OK ${tenant.slug} (${tenant.schemaName})`);
      }
    } catch (err) {
      failures += 1;
      console.error(`ERRO ${tenant.slug} (${tenant.schemaName}):`, err);
    }
  }

  console.log(`Concluído. Migrados=${migrated} Erros=${failures}.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Falha ao migrar skills v2:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
