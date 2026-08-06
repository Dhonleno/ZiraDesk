// Fase 1 do roteamento canonico (Grupo -> Assunto): schema aditivo.
//
// Execução: docker compose run --rm api-migrate \
//   ./apps/api/node_modules/.bin/tsx \
//   apps/api/src/scripts/migrate-canonical-routing.ts
//
// Um schema especifico (usado para aplicar so no tenant de teste antes da producao):
//   ... apps/api/src/scripts/migrate-canonical-routing.ts --schema tenant_homolog_roteamento
//
// Puramente aditivo e idempotente: re-executar nao produz mudanca.

import { prisma } from '../config/database.js';
import { ensureCanonicalRoutingInfrastructure } from '../modules/admin/routing/routing.infrastructure.js';

type MigrationResult = {
  schemaName: string;
  migrated: boolean;
};

async function migrateSchema(schemaName: string): Promise<MigrationResult> {
  // As tabelas das quais o schema aditivo depende por FK.
  const requiredTables = ['users', 'skills', 'bot_options', 'conversations'];

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

  await ensureCanonicalRoutingInfrastructure(prisma, schemaName);
  return { schemaName, migrated: true };
}

export async function main(): Promise<void> {
  const schemaArgIndex = process.argv.indexOf('--schema');
  const singleSchema = schemaArgIndex !== -1 ? process.argv[schemaArgIndex + 1] : undefined;

  let targets: Array<{ slug: string; schemaName: string }>;

  if (singleSchema) {
    const tenant = await prisma.tenant.findFirst({
      where: { schemaName: singleSchema },
      select: { slug: true, schemaName: true },
    });

    if (!tenant) {
      console.error(`Nenhum tenant com schema_name = ${singleSchema}`);
      process.exitCode = 1;
      return;
    }

    targets = [tenant];
    console.log(`Migrando roteamento canonico em 1 tenant (--schema ${singleSchema})...`);
  } else {
    targets = await prisma.tenant.findMany({
      where: { status: { in: ['active', 'trial'] } },
      select: { slug: true, schemaName: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`Migrando roteamento canonico em ${targets.length} tenants...`);
  }

  let failures = 0;
  let migrated = 0;

  for (const tenant of targets) {
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
    console.error('Falha ao migrar roteamento canonico:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
