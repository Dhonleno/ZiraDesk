import { prisma } from '../../../config/database.js';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const ensuredSchemas = new Set<string>();
const inflight = new Map<string, Promise<void>>();

export async function ensureCampaignsInfrastructure(schemaName: string): Promise<void> {
  if (ensuredSchemas.has(schemaName)) return;

  const existingPromise = inflight.get(schemaName);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const schema = quoteIdent(schemaName);

  const run = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${schema}.campaigns (
        id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        name                VARCHAR(255) NOT NULL,
        status              VARCHAR(30)  NOT NULL DEFAULT 'draft',
        channel_id          UUID REFERENCES ${schema}.channels(id) ON DELETE SET NULL,
        template_id         UUID,
        template_variables  JSONB        NOT NULL DEFAULT '{}',
        template_header_media_url TEXT,
        template_header_media_filename TEXT,
        scheduled_at        TIMESTAMPTZ,
        started_at          TIMESTAMPTZ,
        completed_at        TIMESTAMPTZ,
        cancelled_at        TIMESTAMPTZ,
        total_contacts      INT          NOT NULL DEFAULT 0,
        sent_count          INT          NOT NULL DEFAULT 0,
        delivered_count     INT          NOT NULL DEFAULT 0,
        read_count          INT          NOT NULL DEFAULT 0,
        replied_count       INT          NOT NULL DEFAULT 0,
        failed_count        INT          NOT NULL DEFAULT 0,
        daily_limit         INT          NOT NULL DEFAULT 500,
        created_by          UUID REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        notes               TEXT,
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${schema}.campaigns
        ADD COLUMN IF NOT EXISTS template_header_media_url TEXT,
        ADD COLUMN IF NOT EXISTS template_header_media_filename TEXT
    `);

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_campaigns_status ON ${schema}.campaigns(status)`,
    );

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled ON ${schema}.campaigns(scheduled_at) WHERE scheduled_at IS NOT NULL`,
    );

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${schema}.campaign_contacts (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id     UUID        NOT NULL REFERENCES ${schema}.campaigns(id) ON DELETE CASCADE,
        contact_id      UUID        NOT NULL REFERENCES ${schema}.contacts(id) ON DELETE CASCADE,
        status          VARCHAR(30) NOT NULL DEFAULT 'pending',
        message_id      VARCHAR(255),
        conversation_id UUID        REFERENCES ${schema}.conversations(id) ON DELETE SET NULL,
        error_message   TEXT,
        sent_at         TIMESTAMPTZ,
        delivered_at    TIMESTAMPTZ,
        read_at         TIMESTAMPTZ,
        replied_at      TIMESTAMPTZ,
        failed_at       TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_contacts_unique ON ${schema}.campaign_contacts(campaign_id, contact_id)`,
    );

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign ON ${schema}.campaign_contacts(campaign_id)`,
    );

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_campaign_contacts_message ON ${schema}.campaign_contacts(message_id) WHERE message_id IS NOT NULL`,
    );

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${schema}.campaign_optouts (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id    UUID        REFERENCES ${schema}.contacts(id) ON DELETE CASCADE,
        phone         VARCHAR(30) NOT NULL,
        opted_out_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        campaign_id   UUID        REFERENCES ${schema}.campaigns(id) ON DELETE SET NULL
      )
    `);

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_optouts_contact ON ${schema}.campaign_optouts(contact_id)`,
    );

    ensuredSchemas.add(schemaName);
  })().finally(() => {
    inflight.delete(schemaName);
  });

  inflight.set(schemaName, run);
  await run;
}
