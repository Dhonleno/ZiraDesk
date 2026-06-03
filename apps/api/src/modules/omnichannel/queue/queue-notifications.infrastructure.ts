import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../conversations/protocols.js';

export async function ensureQueueNotificationsInfrastructure(schemaName: string): Promise<void> {
  const convRef = `${quoteIdent(schemaName)}.conversations`;
  const notifRef = `${quoteIdent(schemaName)}.queue_notifications`;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${notifRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES ${convRef}(id) ON DELETE CASCADE,
      last_position INT NOT NULL,
      last_notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      message_id VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_queue_notif_conv
    ON ${notifRef}(conversation_id)
  `);
}
