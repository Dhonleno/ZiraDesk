import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

// CONCURRENTLY não pode rodar dentro de transaction — schema é qualificado
// explicitamente em cada statement, sem depender de SET search_path.
const STATEMENTS = [
  (s: string) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_status ON "${s}".conversations(status)`,
  (s: string) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_assigned_to ON "${s}".conversations(assigned_to)`,
  (s: string) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_contact_id ON "${s}".conversations(contact_id)`,
  (s: string) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_channel_id ON "${s}".conversations(channel_id)`,
  (s: string) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_last_message_at ON "${s}".conversations(last_message_at DESC)`,
  (s: string) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_autoassign ON "${s}".conversations(status, assigned_to, queue_entered_at ASC NULLS LAST) WHERE status = 'open' AND assigned_to IS NULL`,
  (s: string) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_created_at ON "${s}".conversations(created_at DESC)`,
  (s: string) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_id ON "${s}".messages(conversation_id)`,
];

async function run() {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { slug: true, schemaName: true },
  });

  logger.info(`Aplicando índices em ${tenants.length} tenants...`);

  for (const tenant of tenants) {
    let failed = false;
    for (const stmtFn of STATEMENTS) {
      const sql = stmtFn(tenant.schemaName);
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (err) {
        logger.error({ err, schemaName: tenant.schemaName, sql }, `✗ ${tenant.slug}`);
        failed = true;
      }
    }
    if (!failed) {
      logger.info(`✓ ${tenant.slug}`);
    }
  }

  logger.info('Concluído.');
  await prisma.$disconnect();
}

run();
