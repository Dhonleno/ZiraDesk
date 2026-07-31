import type { RawExecutor } from '../../modules/crm/crm.db.js';
import { LGPD_REQUEST_COLUMNS, lgpdRequestsRef } from './schema.js';

export interface LgpdInsertedRequest {
  id: string;
  contact_id: string | null;
  user_id: string | null;
  subject_type: string;
  request_type: string;
  status: string;
  requested_by: string | null;
  processed_by: string | null;
  payload: unknown;
  result: unknown;
  requested_at: Date;
  processed_at: Date | null;
  sla_deadline: Date | null;
  notified_at: Date | null;
  reminder_sent_at: Date | null;
}

/**
 * Resolve o schema alvo. Os call sites do CRM entram por
 * `withOptionalSchema(...)`, que recorre passando `schemaName: undefined` e um
 * `tx` já com `SET LOCAL search_path` — nesses casos o nome vem de
 * `current_schema()`, mesmo padrão de `ensureTicketInfrastructure`.
 */
async function resolveSchemaName(db: RawExecutor, schemaName?: string): Promise<string> {
  if (schemaName) return schemaName;

  const rows = await db.$queryRawUnsafe<Array<{ schema_name: string | null }>>(
    'SELECT current_schema() AS schema_name',
  );
  const resolved = rows[0]?.schema_name;
  if (!resolved) {
    throw new Error('Não foi possível resolver o schema ativo para lgpd_requests');
  }
  return resolved;
}

export async function createLgpdRequestRecord(
  input: {
    subjectType: 'contact' | 'user' | 'external';
    subjectId?: string | null;
    requestType: string;
    actorUserId: string | null;
    payload: Record<string, unknown>;
    result: Record<string, unknown>;
    status?: 'processed' | 'pending';
  },
  db: RawExecutor,
  schemaName?: string,
): Promise<LgpdInsertedRequest> {
  const isContact = input.subjectType === 'contact';
  const isUser = input.subjectType === 'user';
  const isPending = input.status === 'pending';
  const processedAtExpr = isPending ? 'NULL' : 'NOW()';
  const slaDeadlineExpr = isPending ? "NOW() + INTERVAL '15 days'" : 'NULL';

  // SEMPRE qualificado. O ramo não-qualificado antigo (`lgpd_requests` cru,
  // resolvido pelo search_path) produzia texto de statement idêntico entre
  // tenants: mesmo prepared statement reusado na mesma conexão do pool contra
  // schemas de shape diferente — o par de colisão do 0A000. Qualificar dá a
  // cada schema seu próprio statement no cache do driver.
  const tableRef = lgpdRequestsRef(await resolveSchemaName(db, schemaName));

  // Colunas explícitas em vez de `RETURNING *`: fixa contagem e ordem do
  // descritor de resultado, independente de colunas adicionadas por retrofit.
  const returningColumns = LGPD_REQUEST_COLUMNS.join(', ');

  const rows = await db.$queryRawUnsafe<LgpdInsertedRequest[]>(
    `INSERT INTO ${tableRef} (
       contact_id, user_id, subject_type, request_type, status,
       requested_by, processed_by, payload, result, processed_at, sla_deadline
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb, $9::jsonb, ${processedAtExpr}, ${slaDeadlineExpr})
     RETURNING ${returningColumns}`,
    isContact ? (input.subjectId ?? null) : null,
    isUser ? (input.subjectId ?? null) : null,
    input.subjectType,
    input.requestType,
    input.status ?? 'processed',
    input.actorUserId ?? null,
    input.actorUserId ?? null,
    JSON.stringify(input.payload),
    JSON.stringify(input.result),
  );

  return rows[0]!;
}
