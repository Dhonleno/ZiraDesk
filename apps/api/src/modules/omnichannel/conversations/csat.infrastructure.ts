import { prisma } from '../../../config/database.js';
import { quoteIdent } from './protocols.js';

type CsatDbClient = Pick<typeof prisma, '$executeRawUnsafe'>;

export async function ensureConversationCsatInfrastructure(
  db: CsatDbClient,
  schemaName?: string | null,
): Promise<void> {
  const conversationsRef = schemaName ? `${quoteIdent(schemaName)}.conversations` : 'conversations';

  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS csat_score INTEGER`,
  );
  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS csat_comment TEXT`,
  );
  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS csat_sent_at TIMESTAMPTZ`,
  );
  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS csat_responded_at TIMESTAMPTZ`,
  );
  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS csat_stage VARCHAR(20)`,
  );
  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS csat_expires_at TIMESTAMPTZ`,
  );

  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'conversations_csat_score_check'
          AND conrelid = '${conversationsRef}'::regclass
      ) THEN
        ALTER TABLE ${conversationsRef}
        ADD CONSTRAINT conversations_csat_score_check
        CHECK (csat_score IS NULL OR (csat_score BETWEEN 1 AND 5));
      END IF;
    END
    $$;
  `);
}
