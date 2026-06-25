import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

async function run() {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { slug: true, schemaName: true },
  });

  logger.info(`Aplicando migration em ${tenants.length} tenants...`);

  for (const tenant of tenants) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${tenant.schemaName}".tickets
         ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
         ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`,
      );
      logger.info(`✓ ${tenant.slug}`);
    } catch (err) {
      logger.error({ err }, `✗ ${tenant.slug}`);
    }
  }

  logger.info('Concluído.');
  await prisma.$disconnect();
}

run();
