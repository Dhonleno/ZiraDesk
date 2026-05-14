import { quoteIdent } from './protocols.js';

type RawQueryClient = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

interface ConversationSocketRow {
  id: string;
  status: string | null;
  assigned_to: string | null;
  metadata: unknown;
}

export interface SocketConversationPayload {
  id: string;
  status: string | null;
  assigned_to: string | null;
  assignedTo: string | null;
  assignedAgentId: string | null;
  metadata: Record<string, unknown> | null;
}

function asMetadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  return metadata as Record<string, unknown>;
}

export async function loadConversationSocketPayload(
  db: RawQueryClient,
  schemaName: string,
  conversationId: string,
): Promise<SocketConversationPayload | null> {
  const rows = await db.$queryRawUnsafe<ConversationSocketRow[]>(
    `SELECT id::text AS id, status::text AS status, assigned_to::text AS assigned_to, metadata
       FROM ${quoteIdent(schemaName)}.conversations
      WHERE id = $1::uuid
      LIMIT 1`,
    conversationId,
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    status: row.status ?? null,
    assigned_to: row.assigned_to ?? null,
    assignedTo: row.assigned_to ?? null,
    assignedAgentId: row.assigned_to ?? null,
    metadata: asMetadataRecord(row.metadata),
  };
}
