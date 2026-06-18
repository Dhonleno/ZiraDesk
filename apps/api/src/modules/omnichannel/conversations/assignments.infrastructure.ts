import type { PrismaClient } from '@prisma/client';
import { quoteIdent } from './protocols.js';

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

export async function ensureConversationAssignmentsInfrastructure(
  db: PrismaClient,
  schemaName: string,
): Promise<void> {
  const assignRef = tableRef(schemaName, 'conversation_assignments');
  const convRef = tableRef(schemaName, 'conversations');
  const usersRef = tableRef(schemaName, 'users');

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${assignRef} (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ${convRef}(id) ON DELETE CASCADE,
      agent_id        UUID NOT NULL REFERENCES ${usersRef}(id) ON DELETE CASCADE,
      assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      released_at     TIMESTAMPTZ,
      release_reason  VARCHAR(30),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_conv_assignments_conversation"
      ON ${assignRef}(conversation_id)
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_conv_assignments_agent"
      ON ${assignRef}(agent_id)
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_conv_assignments_agent_released"
      ON ${assignRef}(agent_id, released_at)
      WHERE released_at IS NOT NULL
  `);
}
