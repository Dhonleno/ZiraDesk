import type { RawExecutor } from '../../modules/crm/crm.db.js';

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
  const tableRef = schemaName
    ? `"${schemaName.replace(/"/g, '""')}".lgpd_requests`
    : 'lgpd_requests';

  const rows = await db.$queryRawUnsafe<LgpdInsertedRequest[]>(
    `INSERT INTO ${tableRef} (
       contact_id, user_id, subject_type, request_type, status,
       requested_by, processed_by, payload, result, processed_at, sla_deadline
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb, $9::jsonb, ${processedAtExpr}, ${slaDeadlineExpr})
     RETURNING *`,
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
