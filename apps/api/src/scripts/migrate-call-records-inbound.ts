import { prisma } from '../config/database.js';
import { ensureCallRecordsInfrastructure } from '../modules/calls/calls.service.js';

async function main(): Promise<void> {
  const tenants = await prisma.$queryRaw<Array<{ schema_name: string }>>`
    SELECT schema_name
    FROM public.tenants
    WHERE status IN ('active', 'trial')
    ORDER BY created_at ASC
  `;

  console.log(`Migrando infraestrutura de chamadas em ${tenants.length} tenants...`);

  let failures = 0;

  for (const tenant of tenants) {
    try {
      await ensureCallRecordsInfrastructure(prisma, tenant.schema_name);
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
    console.error('Falha ao migrar infraestrutura de chamadas:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
