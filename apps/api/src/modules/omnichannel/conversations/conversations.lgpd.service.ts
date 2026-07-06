import { prisma } from '../../../config/database.js';
import { createLgpdRequestRecord } from '../../../lib/lgpd/index.js';
import { withTenantSchema, type RawExecutor } from '../../crm/crm.db.js';

interface ExternalAnonymizeResult {
  request_id: string;
  summary: {
    conversations_anonymized: number;
    messages_redacted: number;
  };
}

interface ExternalRequestRow {
  id: string;
  subject_type: string;
  request_type: string;
  status: string;
  requested_by: string | null;
  requested_by_name: string | null;
  processed_by: string | null;
  processed_by_name: string | null;
  payload: unknown;
  result: unknown;
  requested_at: Date;
  processed_at: Date | null;
}

interface PaginationMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export class ExternalIdNotFoundError extends Error {
  constructor() {
    super('Nenhuma conversa encontrada para este identificador externo');
    this.name = 'ExternalIdNotFoundError';
  }
}

export class AlreadyAnonymizedError extends Error {
  constructor() {
    super('Este identificador externo já foi anonimizado anteriormente');
    this.name = 'AlreadyAnonymizedError';
  }
}

export async function anonymizeByExternalId(
  externalId: string,
  reason: string,
  actorUserId: string,
  schemaName: string,
): Promise<ExternalAnonymizeResult> {
  return withTenantSchema(schemaName, async (db) => {
    const existingConvs = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM conversations
       WHERE external_id = $1
         AND contact_id IS NULL
       LIMIT 1`,
      externalId,
    );

    if (!existingConvs[0]) {
      const alreadyHashed = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM conversations
         WHERE external_id = encode(sha256($1::bytea), 'hex')
         LIMIT 1`,
        externalId,
      );
      if (alreadyHashed[0]) {
        throw new AlreadyAnonymizedError();
      }
      throw new ExternalIdNotFoundError();
    }

    const updatedConvRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE conversations
       SET external_id = encode(sha256(external_id::bytea), 'hex'),
           last_message = CASE WHEN last_message IS NULL THEN NULL ELSE '[mensagem anonimizada por LGPD]' END
       WHERE external_id = $1
         AND contact_id IS NULL
       RETURNING id`,
      externalId,
    );

    if (!updatedConvRows.length) {
      throw new ExternalIdNotFoundError();
    }

    const convIds = (updatedConvRows as Array<{ id: string }>).map((r) => r.id);
    const placeholders = convIds.map((_, i) => `$${i + 1}::uuid`).join(', ');

    const redactedMsgRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE messages
       SET content = '[mensagem anonimizada por LGPD]',
           media_url = NULL,
           metadata = COALESCE(metadata, '{}'::jsonb) || '{"lgpd_redacted": true}'::jsonb
       WHERE conversation_id IN (${placeholders})
       RETURNING id`,
      ...convIds,
    );

    await db.$executeRawUnsafe(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data)
       VALUES ($1::uuid, 'lgpd.external_anonymization', 'conversation', $2::uuid, $3::jsonb)`,
      actorUserId,
      convIds[0],
      JSON.stringify({
        external_id_prefix: externalId.slice(0, 6),
        reason,
        conversations_anonymized: updatedConvRows.length,
        messages_redacted: redactedMsgRows.length,
        anonymized_at: new Date().toISOString(),
      }),
    );

    const request = await createLgpdRequestRecord(
      {
        subjectType: 'external',
        requestType: 'external_anonymization',
        actorUserId,
        payload: { reason },
        result: {
          conversations_anonymized: updatedConvRows.length,
          messages_redacted: redactedMsgRows.length,
          anonymized_at: new Date().toISOString(),
        },
        status: 'processed',
      },
      db,
      schemaName,
    );

    return {
      request_id: request.id,
      summary: {
        conversations_anonymized: updatedConvRows.length,
        messages_redacted: redactedMsgRows.length,
      },
    };
  });
}

export async function listExternalLgpdRequests(
  query: { page: number; per_page: number; status: string | undefined },
  schemaName: string,
): Promise<{ data: ExternalRequestRow[]; meta: PaginationMeta }> {
  const safe = schemaName.replace(/"/g, '""');
  const { page, per_page, status } = query;
  const offset = (page - 1) * per_page;

  const data = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safe}", public`);
    return tx.$queryRawUnsafe<ExternalRequestRow[]>(
      `SELECT
         lr.id, lr.subject_type, lr.request_type, lr.status,
         lr.requested_by,
         ru.name AS requested_by_name,
         lr.processed_by,
         pu.name AS processed_by_name,
         lr.payload, lr.result,
         lr.requested_at, lr.processed_at
       FROM lgpd_requests lr
       LEFT JOIN users ru ON ru.id = lr.requested_by
       LEFT JOIN users pu ON pu.id = lr.processed_by
       WHERE lr.subject_type = 'external'
         AND ($1::text IS NULL OR lr.status = $1::text)
       ORDER BY lr.requested_at DESC
       LIMIT $2 OFFSET $3`,
      status ?? null,
      per_page,
      offset,
    );
  });

  const countRows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safe}", public`);
    return tx.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count FROM lgpd_requests lr
       WHERE lr.subject_type = 'external'
         AND ($1::text IS NULL OR lr.status = $1::text)`,
      status ?? null,
    );
  });

  const total = Number(countRows[0]?.count ?? 0);
  return {
    data,
    meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
  };
}

export async function anonymizeOrphanConversations(
  schemaName: string,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  const safe = schemaName.replace(/"/g, '""');

  const eligibleConvs = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safe}", public`);
    return tx.$queryRawUnsafe<Array<{ external_id: string }>>(
      `SELECT DISTINCT external_id
       FROM conversations
       WHERE contact_id IS NULL
         AND status = 'closed'
         AND external_id IS NOT NULL
         AND external_id != encode(sha256(external_id::bytea), 'hex')
         AND COALESCE(last_message_at, created_at) <= NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY external_id
       LIMIT $2`,
      retentionDays,
      batchSize,
    );
  });

  if (!eligibleConvs.length) return 0;

  let processed = 0;

  for (const row of eligibleConvs) {
    const externalId = row.external_id;

    await withTenantSchema(schemaName, async (db: RawExecutor) => {
      const convRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE conversations
         SET external_id = encode(sha256(external_id::bytea), 'hex'),
             last_message = CASE WHEN last_message IS NULL THEN NULL ELSE '[mensagem anonimizada por LGPD]' END
         WHERE external_id = $1
           AND contact_id IS NULL
         RETURNING id`,
        externalId,
      );

      if (!convRows.length) return;

      const convIds = (convRows as Array<{ id: string }>).map((r) => r.id);
      const placeholders = convIds.map((_, i) => `$${i + 1}::uuid`).join(', ');

      await db.$executeRawUnsafe(
        `UPDATE messages
         SET content = '[mensagem anonimizada por LGPD]',
             media_url = NULL,
             metadata = COALESCE(metadata, '{}'::jsonb) || '{"lgpd_redacted": true}'::jsonb
         WHERE conversation_id IN (${placeholders})`,
        ...convIds,
      );

      await createLgpdRequestRecord(
        {
          subjectType: 'external',
          requestType: 'external_anonymization',
          actorUserId: null,
          payload: { reason: `Retenção LGPD automática (${retentionDays} dias)` },
          result: {
            conversations_anonymized: convIds.length,
            anonymized_at: new Date().toISOString(),
          },
          status: 'processed',
        },
        db,
        schemaName,
      );
    });

    processed += 1;
  }

  return processed;
}
