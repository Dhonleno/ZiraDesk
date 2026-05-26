import { prisma } from '../../../config/database.js';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const ensuredSchemas = new Set<string>();

export async function ensureUsersLgpdInfrastructure(schemaName: string): Promise<void> {
  if (ensuredSchemas.has(schemaName)) return;

  const schema = quoteIdent(schemaName);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.users
    ADD COLUMN IF NOT EXISTS lgpd_consent_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS lgpd_consent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lgpd_consent_source VARCHAR(100),
    ADD COLUMN IF NOT EXISTS lgpd_last_export_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lgpd_anonymized_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lgpd_anonymization_reason TEXT
  `);

  const tableRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    `${schemaName}.lgpd_requests`,
  );

  if (tableRows[0]?.exists) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${schema}.lgpd_requests
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES ${schema}.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS subject_type VARCHAR(20) NOT NULL DEFAULT 'contact',
      ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${schema}.lgpd_requests
      ALTER COLUMN sla_deadline SET DEFAULT (NOW() + INTERVAL '15 days')
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE ${schema}.lgpd_requests
      SET sla_deadline = requested_at + INTERVAL '15 days'
      WHERE status = 'pending'
        AND sla_deadline IS NULL
    `);

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_lgpd_requests_user ON ${schema}.lgpd_requests(user_id)`,
    );
  }

  ensuredSchemas.add(schemaName);
}
