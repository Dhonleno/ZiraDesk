import { prisma } from '../config/database.js';
import { ensureWebhooksInfrastructure } from '../modules/admin/webhooks/webhooks.service.js';

async function main(): Promise<void> {
  const tenants = await prisma.$queryRaw<Array<{ schema_name: string }>>`
    SELECT schema_name
    FROM public.tenants
    WHERE status = 'active'
    ORDER BY created_at ASC
  `;

  console.log(`Migrando ${tenants.length} tenants...`);

  let failures = 0;

  for (const tenant of tenants) {
    try {
      await ensureWebhooksInfrastructure(tenant.schema_name);
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
    console.error('Falha ao migrar outbound_webhooks:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
