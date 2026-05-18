import { prisma } from '../../../config/database.js';

type ProtocolDbClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;
type PrismaRawError = {
  code?: string;
  meta?: {
    code?: string;
    message?: string;
  };
};

const protocolInfraReady = new Set<string>();
const protocolInfraInFlight = new Map<string, Promise<void>>();

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

function getSchemaInfraKey(schemaName?: string | null): string {
  return schemaName?.trim() || 'public';
}

function isTupleConcurrentlyUpdatedError(error: unknown): boolean {
  const raw = error as PrismaRawError;
  const code = raw?.code;
  const metaCode = raw?.meta?.code;
  const metaMessage = raw?.meta?.message?.toLowerCase() ?? '';
  return (code === 'P2010' || metaCode === 'XX000') && metaMessage.includes('tuple concurrently updated');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function execRawWithRetry(
  db: ProtocolDbClient,
  query: string,
  ...params: unknown[]
): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await db.$executeRawUnsafe(query, ...params);
      return;
    } catch (error) {
      if (!isTupleConcurrentlyUpdatedError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(40 * attempt);
    }
  }
}

export async function ensureConversationProtocolInfrastructure(
  db: ProtocolDbClient,
  schemaName?: string | null,
): Promise<void> {
  const infraKey = getSchemaInfraKey(schemaName);
  if (protocolInfraReady.has(infraKey)) {
    return;
  }

  const running = protocolInfraInFlight.get(infraKey);
  if (running) {
    await running;
    return;
  }

  const run = (async () => {
  const conversationsRef = schemaName ? `${quoteIdent(schemaName)}.conversations` : 'conversations';
  await execRawWithRetry(
    db,
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS protocol_number VARCHAR(20) UNIQUE`,
  );

  await execRawWithRetry(
    db,
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS conversation_type VARCHAR(20) DEFAULT 'inbound'`,
  );

  await execRawWithRetry(
    db,
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS outbound_expires_at TIMESTAMPTZ`,
  );

  await execRawWithRetry(
    db,
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS outbound_origin_agent_id UUID`,
  );

  await execRawWithRetry(
    db,
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS outbound_returned_at TIMESTAMPTZ`,
  );

  await execRawWithRetry(
    db,
    `ALTER TABLE ${conversationsRef}
     ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`,
  );

  try {
    await execRawWithRetry(
      db,
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

  await execRawWithRetry(
    db,
    `UPDATE ${conversationsRef}
     SET conversation_type = 'inbound'
     WHERE conversation_type IS NULL`,
  );

  await execRawWithRetry(
    db,
    `UPDATE ${conversationsRef}
     SET outbound_origin_agent_id = assigned_to
     WHERE conversation_type = 'outbound'
       AND outbound_origin_agent_id IS NULL
       AND assigned_to IS NOT NULL`,
  );

  await execRawWithRetry(
    db,
    `UPDATE ${conversationsRef}
     SET assigned_at = created_at
     WHERE assigned_to IS NOT NULL
       AND assigned_at IS NULL`,
  );

  await execRawWithRetry(db, buildGenerateProtocolSql(schemaName));

  protocolInfraReady.add(infraKey);
  })().finally(() => {
    protocolInfraInFlight.delete(infraKey);
  });

  protocolInfraInFlight.set(infraKey, run);
  await run;
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
