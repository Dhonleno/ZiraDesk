import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const ensuredSchemas = new Set<string>();
const inflight = new Map<string, Promise<void>>();

export async function ensureCrmInfrastructure(schemaName: string): Promise<void> {
  if (ensuredSchemas.has(schemaName)) return;

  const existingPromise = inflight.get(schemaName);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const schema = quoteIdent(schemaName);

  const run = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${schema}.organizations (
        id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        type            VARCHAR(20)  NOT NULL DEFAULT 'company',
        name            VARCHAR(150) NOT NULL,
        document        VARCHAR(20),
        email           VARCHAR(255),
        phone           VARCHAR(30),
        website         VARCHAR(255),
        status          VARCHAR(30)  NOT NULL DEFAULT 'lead',
        address_street  VARCHAR(200),
        address_city    VARCHAR(100),
        address_state   VARCHAR(2),
        address_zip     VARCHAR(10),
        segment         VARCHAR(100),
        lead_source     VARCHAR(100),
        responsible_id  UUID REFERENCES ${schema}.users(id) ON DELETE SET NULL,
        tags            TEXT[]       NOT NULL DEFAULT '{}',
        custom_fields   JSONB        NOT NULL DEFAULT '{}',
        notes           TEXT,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${schema}.contacts (
        id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES ${schema}.organizations(id) ON DELETE SET NULL,
        name            VARCHAR(150) NOT NULL,
        email           VARCHAR(255),
        phone           VARCHAR(30),
        whatsapp        VARCHAR(30),
        document        VARCHAR(20),
        role            VARCHAR(100),
        department      VARCHAR(100),
        is_primary      BOOLEAN      NOT NULL DEFAULT false,
        avatar_url      VARCHAR(500),
        tags            TEXT[]       NOT NULL DEFAULT '{}',
        custom_fields   JSONB        NOT NULL DEFAULT '{}',
        notes           TEXT,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_contacts_organization ON ${schema}.contacts(organization_id)`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp ON ${schema}.contacts(whatsapp)`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_contacts_phone ON ${schema}.contacts(phone)`,
    );

    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${schema}.conversations
      ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES ${schema}.contacts(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES ${schema}.organizations(id) ON DELETE SET NULL
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${schema}.tickets
      ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES ${schema}.contacts(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES ${schema}.organizations(id) ON DELETE SET NULL
    `);

    ensuredSchemas.add(schemaName);
  })()
    .finally(() => {
      inflight.delete(schemaName);
    });

  inflight.set(schemaName, run);
  await run;
}

export async function ensureCrmInfrastructureMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user || request.user.isSuperAdmin) {
    return reply.code(403).send({ error: 'Acesso não permitido' });
  }

  const schemaName = request.user.schemaName;
  if (!schemaName) {
    return reply.code(500).send({ error: 'Schema do tenant não resolvido' });
  }

  await ensureCrmInfrastructure(schemaName);
}

