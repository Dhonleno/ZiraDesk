import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

type MigrationResult = {
  schemaName: string;
  migrated: boolean;
  backfilled: number;
  backfilledAssignments: number;
  closedWithoutClosedBy: number;
};

async function migrateSchema(schemaName: string): Promise<MigrationResult> {
  const schema = quoteIdent(schemaName);

  const tableRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.conversations`,
  );

  if (!tableRows[0]?.exists) {
    console.log(`IGNORADO ${schemaName} (tabela conversations ausente)`);
    return {
      schemaName,
      migrated: false,
      backfilled: 0,
      backfilledAssignments: 0,
      closedWithoutClosedBy: 0,
    };
  }

  const usersRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.users`,
  );

  if (!usersRows[0]?.exists) {
    console.log(`IGNORADO ${schemaName} (tabela users ausente)`);
    return {
      schemaName,
      migrated: false,
      backfilled: 0,
      backfilledAssignments: 0,
      closedWithoutClosedBy: 0,
    };
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.conversations
      ADD COLUMN IF NOT EXISTS closed_by_user_id UUID REFERENCES ${schema}.users(id) ON DELETE SET NULL
  `);

  // Passada 1: closure_reason->>'agentId'
  const updatedRows = await prisma.$queryRawUnsafe<Array<{ updated_count: bigint }>>(`
    WITH updated AS (
      UPDATE ${schema}.conversations
      SET closed_by_user_id = (closure_reason->>'agentId')::uuid
      WHERE status = 'closed'
        AND closed_by_user_id IS NULL
        AND closure_reason->>'agentId' IS NOT NULL
        AND closure_reason->>'agentId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      RETURNING 1
    )
    SELECT COUNT(*) AS updated_count FROM updated
  `);

  // Passada 2: conversation_assignments (release_reason='closed'), somente onde ainda NULL
  let backfilledAssignments = 0;
  const assignmentsTableRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.conversation_assignments`,
  );

  if (assignmentsTableRows[0]?.exists) {
    const dupRows = await prisma.$queryRawUnsafe<Array<{ dup_count: bigint }>>(`
      SELECT COUNT(*) AS dup_count
      FROM (
        SELECT conversation_id
        FROM ${schema}.conversation_assignments
        WHERE release_reason = 'closed'
          AND agent_id IS NOT NULL
        GROUP BY conversation_id
        HAVING COUNT(*) > 1
      ) dup
    `);
    const dupCount = Number(dupRows[0]?.dup_count ?? 0n);
    if (dupCount > 0) {
      console.warn(
        `AVISO ${schemaName}: ${dupCount} conversa(s) com múltiplas linhas release_reason='closed' em conversation_assignments — usando a mais recente (released_at DESC)`,
      );
    }

    const assignmentsUpdatedRows = await prisma.$queryRawUnsafe<Array<{ updated_count: bigint }>>(`
      WITH updated AS (
        UPDATE ${schema}.conversations c
        SET closed_by_user_id = (
          SELECT ca.agent_id
          FROM ${schema}.conversation_assignments ca
          WHERE ca.conversation_id = c.id
            AND ca.release_reason = 'closed'
            AND ca.agent_id IS NOT NULL
          ORDER BY ca.released_at DESC
          LIMIT 1
        )
        WHERE c.status = 'closed'
          AND c.closed_by_user_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM ${schema}.conversation_assignments ca
            WHERE ca.conversation_id = c.id
              AND ca.release_reason = 'closed'
              AND ca.agent_id IS NOT NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) AS updated_count FROM updated
    `);
    backfilledAssignments = Number(assignmentsUpdatedRows[0]?.updated_count ?? 0n);
  }

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_conversations_closed_by_status
      ON ${schema}.conversations(closed_by_user_id, status)
      WHERE status = 'closed'
  `);

  const nullRows = await prisma.$queryRawUnsafe<Array<{ remaining_count: bigint }>>(`
    SELECT COUNT(*) AS remaining_count
    FROM ${schema}.conversations
    WHERE status = 'closed'
      AND closed_by_user_id IS NULL
  `);

  return {
    schemaName,
    migrated: true,
    backfilled: Number(updatedRows[0]?.updated_count ?? 0n),
    backfilledAssignments,
    closedWithoutClosedBy: Number(nullRows[0]?.remaining_count ?? 0n),
  };
}

async function main(): Promise<void> {
  const schemaArg = process.argv.find((arg) => arg.startsWith('--schema='));
  const targetSchema = schemaArg?.slice('--schema='.length);
  const tenants = targetSchema
    ? [{ schema_name: targetSchema }]
    : await prisma.$queryRaw<Array<{ schema_name: string }>>`
        SELECT schema_name
        FROM public.tenants
        WHERE schema_name IS NOT NULL
        ORDER BY created_at ASC
      `;

  console.log(`Migrando closed_by_user_id em ${tenants.length} tenants...`);

  let failures = 0;
  const results: MigrationResult[] = [];

  for (const tenant of tenants) {
    try {
      const result = await migrateSchema(tenant.schema_name);
      results.push(result);
      if (result.migrated) {
        console.log(
          `OK ${tenant.schema_name}: backfill=${result.backfilled} backfill_assignments=${result.backfilledAssignments} closed_null=${result.closedWithoutClosedBy}`,
        );
      }
    } catch (err) {
      failures += 1;
      console.error(`ERRO ${tenant.schema_name}:`, err);
    }
  }

  const migratedResults = results.filter((result) => result.migrated);
  const totalBackfilled = migratedResults.reduce((sum, result) => sum + result.backfilled, 0);
  const totalBackfilledAssignments = migratedResults.reduce((sum, result) => sum + result.backfilledAssignments, 0);
  const totalNull = migratedResults.reduce((sum, result) => sum + result.closedWithoutClosedBy, 0);

  console.log(`Concluído. Backfill=${totalBackfilled} backfill_assignments=${totalBackfilledAssignments} closed_null=${totalNull}.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Falha ao migrar closed_by_user_id em conversations:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
