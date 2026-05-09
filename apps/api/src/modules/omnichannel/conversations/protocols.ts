import { prisma } from '../../../config/database.js';

type ProtocolDbClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;

export function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildGenerateProtocolSql(schemaName?: string | null): string {
  const tableRef = schemaName ? `${quoteIdent(schemaName)}.conversations` : 'conversations';
  const functionRef = schemaName ? `${quoteIdent(schemaName)}.generate_protocol` : 'generate_protocol';

  return `
    CREATE OR REPLACE FUNCTION ${functionRef}()
    RETURNS VARCHAR AS $$
    DECLARE
      year_month TEXT;
      next_seq INTEGER;
      protocol TEXT;
    BEGIN
      year_month := TO_CHAR(NOW(), 'YYYYMM');
      PERFORM pg_advisory_xact_lock(hashtext('protocol:' || year_month)::bigint);

      SELECT COALESCE(MAX(CAST(SUBSTRING(protocol_number FROM 11) AS INTEGER)), 0) + 1
        INTO next_seq
        FROM ${tableRef}
       WHERE protocol_number LIKE 'ZD-' || year_month || '-%';

      protocol := 'ZD-' || year_month || '-' || LPAD(next_seq::TEXT, 6, '0');
      RETURN protocol;
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function ensureConversationProtocolInfrastructure(
  db: ProtocolDbClient,
  schemaName?: string | null,
): Promise<void> {
  const conversationsRef = schemaName ? `${quoteIdent(schemaName)}.conversations` : 'conversations';

  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS protocol_number VARCHAR(20) UNIQUE`,
  );

  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS conversation_type VARCHAR(20) DEFAULT 'inbound'`,
  );

  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS outbound_expires_at TIMESTAMPTZ`,
  );

  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS outbound_origin_agent_id UUID`,
  );

  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS outbound_returned_at TIMESTAMPTZ`,
  );

  await db.$executeRawUnsafe(
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`,
  );

  try {
    await db.$executeRawUnsafe(
      `UPDATE ${conversationsRef}
       SET conversation_type = 'outbound'
       WHERE metadata->>'type' = 'outbound'
         AND conversation_type IS DISTINCT FROM 'outbound'`,
    );
  } catch (error) {
    // Schemas legados podem não ter a coluna metadata; nesses casos seguimos sem bloquear listagens.
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (!(message.includes('column') && message.includes('metadata') && message.includes('does not exist'))) {
      throw error;
    }
  }

  await db.$executeRawUnsafe(
    `UPDATE ${conversationsRef}
     SET conversation_type = 'inbound'
     WHERE conversation_type IS NULL`,
  );

  await db.$executeRawUnsafe(
    `UPDATE ${conversationsRef}
     SET outbound_origin_agent_id = assigned_to
     WHERE conversation_type = 'outbound'
       AND outbound_origin_agent_id IS NULL
       AND assigned_to IS NOT NULL`,
  );

  await db.$executeRawUnsafe(
    `UPDATE ${conversationsRef}
     SET assigned_at = created_at
     WHERE assigned_to IS NOT NULL
       AND assigned_at IS NULL`,
  );

  await db.$executeRawUnsafe(buildGenerateProtocolSql(schemaName));
}

/**
 * Calls generate_protocol() assuming the function already exists.
 * Use this inside a transaction (after calling ensureConversationProtocolInfrastructure
 * outside the transaction).
 */
export async function callGenerateProtocol(
  db: ProtocolDbClient,
  schemaName?: string | null,
): Promise<string> {
  const functionRef = schemaName ? `${quoteIdent(schemaName)}.generate_protocol` : 'generate_protocol';
  const rows = await db.$queryRawUnsafe<Array<{ protocol: string }>>(
    `SELECT ${functionRef}() AS protocol`,
  );
  return rows[0]!.protocol;
}

/**
 * Ensures infrastructure exists and generates a protocol number.
 * Do NOT call this inside a transaction — the ALTER TABLE/CREATE FUNCTION
 * statements cause "tuple concurrently updated" errors under concurrent requests.
 */
export async function generateConversationProtocol(
  db: ProtocolDbClient,
  schemaName?: string | null,
): Promise<string> {
  await ensureConversationProtocolInfrastructure(db, schemaName);
  return callGenerateProtocol(db, schemaName);
}

export function buildProtocolMessage(protocolNumber: string): string {
  return (
    'Olá! Seu atendimento foi iniciado com sucesso.\n\n' +
    `📋 *Protocolo:* ${protocolNumber}\n\n` +
    'Guarde este número para acompanhar seu atendimento.'
  );
}
