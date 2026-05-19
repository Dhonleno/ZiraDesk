import { prisma } from '../../../config/database.js';

type SmtpDbClient = Pick<typeof prisma, '$executeRawUnsafe'>;

export async function ensureSmtpInfrastructure(db: SmtpDbClient): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS smtp_configs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      host            VARCHAR(255) NOT NULL,
      port            INTEGER NOT NULL DEFAULT 587,
      secure          BOOLEAN DEFAULT false,
      username        VARCHAR(255) NOT NULL,
      password        VARCHAR(255) NOT NULL,
      from_email      VARCHAR(255) NOT NULL,
      from_name       VARCHAR(255),
      is_active       BOOLEAN DEFAULT true,
      last_tested_at  TIMESTAMPTZ,
      last_test_ok    BOOLEAN,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

