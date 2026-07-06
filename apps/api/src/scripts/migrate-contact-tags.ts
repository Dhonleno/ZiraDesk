import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

const TAG_COLORS = ['#00C9A7', '#10B981', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899'] as const;

async function migrateSchema(schemaName: string): Promise<boolean> {
  const schema = quoteIdent(schemaName);

  const contactsTable = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    `${schemaName}.contacts`,
  );

  if (!contactsTable[0]?.exists) {
    console.warn(`IGNORADO ${schemaName}: tabela contacts não existe`);
    return false;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${schema}.contact_tags (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(50) NOT NULL,
        color       VARCHAR(7) NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(name)
      )
    `);

    await tx.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${schema}.contact_tag_assignments (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id  UUID REFERENCES ${schema}.contacts(id) ON DELETE CASCADE,
        tag_id      UUID REFERENCES ${schema}.contact_tags(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(contact_id, tag_id)
      )
    `);

    await tx.$executeRawUnsafe(
      `WITH distinct_tags AS (
         SELECT tag.name,
                ROW_NUMBER() OVER (ORDER BY LOWER(tag.name), tag.name) AS position
         FROM (
           SELECT DISTINCT UNNEST(tags) AS name
           FROM ${schema}.contacts
           WHERE tags IS NOT NULL
             AND ARRAY_LENGTH(tags, 1) > 0
         ) tag
         WHERE tag.name <> ''
       )
       INSERT INTO ${schema}.contact_tags (name, color, sort_order)
       SELECT name,
              ($1::text[])[((position - 1) % CARDINALITY($1::text[])) + 1],
              position
       FROM distinct_tags
       ON CONFLICT (name) DO NOTHING`,
      [...TAG_COLORS],
    );

    await tx.$executeRawUnsafe(`
      INSERT INTO ${schema}.contact_tag_assignments (contact_id, tag_id)
      SELECT DISTINCT contact.id, contact_tag.id
      FROM ${schema}.contacts contact
      CROSS JOIN LATERAL UNNEST(contact.tags) AS assigned_tag(name)
      JOIN ${schema}.contact_tags contact_tag ON contact_tag.name = assigned_tag.name
      ON CONFLICT (contact_id, tag_id) DO NOTHING
    `);
  });

  return true;
}

async function main(): Promise<void> {
  const tenants = await prisma.$queryRaw<Array<{ schema_name: string }>>`
    SELECT schema_name
    FROM public.tenants
    WHERE status IN ('active', 'trial')
    ORDER BY created_at ASC
  `;

  console.log(`Migrando tags de contato em ${tenants.length} tenants...`);

  let failures = 0;

  for (const tenant of tenants) {
    try {
      const migrated = await migrateSchema(tenant.schema_name);
      if (migrated) {
        console.log(`OK ${tenant.schema_name}`);
      }
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
    console.error('Falha ao migrar tags de contato:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
