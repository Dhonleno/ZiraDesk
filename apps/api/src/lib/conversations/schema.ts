export interface RawExecutor {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function resolveSchemaName(db: RawExecutor, schemaName?: string | null): Promise<string> {
  if (schemaName) return schemaName;

  const rows = await db.$queryRawUnsafe<Array<{ schema_name: string | null }>>(
    'SELECT current_schema() AS schema_name',
  );
  const resolved = rows[0]?.schema_name;
  if (!resolved) {
    throw new Error('Não foi possível resolver o schema ativo para conversations');
  }
  return resolved;
}

/**
 * Referência sempre qualificada para `conversations`.
 *
 * Quando o call site já conhece o schema, ele entra como literal. Quando o
 * call site depende do `search_path` ativo, resolvemos `current_schema()` antes
 * de montar o SQL, para que o texto final do statement seja distinto por tenant
 * e não compartilhe o prepared statement entre enums `conversation_status`.
 */
export async function conversationsRef(
  db: RawExecutor,
  schemaName?: string | null,
): Promise<string> {
  return `${quoteIdent(await resolveSchemaName(db, schemaName))}.conversations`;
}
