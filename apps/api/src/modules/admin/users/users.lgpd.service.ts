import { prisma } from '../../../config/database.js';
import { redis } from '../../../config/redis.js';
import { createLgpdRequestRecord } from '../../../lib/lgpd/index.js';
import {
  LGPD_EXPORT_SCHEMA_VERSION,
  validateExportPayload,
} from '../../../lib/lgpd/validate-export.js';
import { logger } from '../../../config/logger.js';
import type {
  UpdateUserLgpdConsentInput,
  AnonymizeUserLgpdInput,
  ListUserLgpdRequestsQuery,
} from './users.schema.js';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function usersTable(schemaName: string): string {
  return `${quoteIdent(schemaName)}.users`;
}

function extractTenantPrivacyMetadata(settings: unknown): {
  dataController: string | null;
  dataProcessor: string | null;
} {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { dataController: null, dataProcessor: null };
  }

  const record = settings as Record<string, unknown>;
  const dataController =
    typeof record['data_controller'] === 'string' ? record['data_controller'] :
      typeof record['dataController'] === 'string' ? record['dataController'] : null;
  const dataProcessor =
    typeof record['data_processor'] === 'string' ? record['data_processor'] :
      typeof record['dataProcessor'] === 'string' ? record['dataProcessor'] : null;

  return { dataController, dataProcessor };
}

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

interface UserLgpdRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_seen_at: Date | null;
  created_at: Date;
  lgpd_consent_status: string;
  lgpd_consent_at: Date | null;
  lgpd_consent_source: string | null;
  lgpd_last_export_at: Date | null;
  lgpd_anonymized_at: Date | null;
  lgpd_anonymization_reason: string | null;
}

interface UserLgpdRequestRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
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

async function getUser(id: string, schemaName: string): Promise<UserLgpdRow> {
  const usersRef = usersTable(schemaName);
  const rows = await prisma.$queryRawUnsafe<UserLgpdRow[]>(
    `SELECT id, name, email, role, status, last_seen_at, created_at,
            lgpd_consent_status, lgpd_consent_at, lgpd_consent_source,
            lgpd_last_export_at, lgpd_anonymized_at, lgpd_anonymization_reason
     FROM ${usersRef}
     WHERE id = $1::uuid LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Usuário');
  return rows[0];
}

export async function updateUserLgpdConsent(
  id: string,
  data: UpdateUserLgpdConsentInput,
  updatedBy: string,
  schemaName: string,
) {
  const schema = quoteIdent(schemaName);
  const usersRef = usersTable(schemaName);

  const previous = await getUser(id, schemaName);

  const rows = await prisma.$queryRawUnsafe<UserLgpdRow[]>(
    `UPDATE ${usersRef} SET
       lgpd_consent_status = $1,
       lgpd_consent_source = CASE WHEN $2::boolean THEN $3 ELSE lgpd_consent_source END,
       lgpd_consent_at = NOW(),
       updated_at = NOW()
     WHERE id = $4::uuid
     RETURNING *`,
    data.status,
    data.source !== undefined,
    data.source ?? null,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Usuário');

  const updated = rows[0];
  const request = await createLgpdRequestRecord(
    {
      subjectType: 'user',
      subjectId: id,
      requestType: 'consent_update',
      actorUserId: updatedBy,
      payload: { status: data.status, source: data.source ?? null },
      result: { consent_at: updated.lgpd_consent_at?.toISOString() ?? null },
    },
    prisma,
    schemaName,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'user.lgpd.consent_updated', 'user', $2::uuid, $3::jsonb, $4::jsonb)`,
    updatedBy,
    id,
    JSON.stringify({
      lgpd_consent_status: previous.lgpd_consent_status,
      lgpd_consent_source: previous.lgpd_consent_source,
      lgpd_consent_at: previous.lgpd_consent_at,
    }),
    JSON.stringify({
      lgpd_consent_status: updated.lgpd_consent_status,
      lgpd_consent_source: updated.lgpd_consent_source,
      lgpd_consent_at: updated.lgpd_consent_at,
      lgpd_request_id: request.id,
    }),
  );

  return { user: updated, request };
}

export async function exportUserLgpdData(
  id: string,
  actorUserId: string,
  options: { includeAuditLogs: boolean },
  schemaName: string,
) {
  const schema = quoteIdent(schemaName);
  const usersRef = usersTable(schemaName);

  const user = await getUser(id, schemaName);
  const exportedAt = new Date();
  const exportedAtIso = exportedAt.toISOString();

  const actorRows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string | null; email: string | null }>>(
    `SELECT id, name, email
     FROM ${schema}.users
     WHERE id = $1::uuid
     LIMIT 1`,
    actorUserId,
  ).catch(() => []);
  const actor = actorRows[0];

  const tenantRows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; settings: unknown }>>(
    `SELECT id, name, settings
     FROM public.tenants
     WHERE schema_name = $1
     LIMIT 1`,
    schemaName,
  ).catch(() => []);
  const tenant = tenantRows[0];
  const tenantPrivacy = extractTenantPrivacyMetadata(tenant?.settings);

  const tickets = await prisma.$queryRawUnsafe<Array<{
    id: string; title: string; status: string; priority: string; created_at: Date;
  }>>(
    `SELECT id, title, status, priority, created_at
     FROM ${schema}.tickets
     WHERE assigned_to = $1::uuid
     ORDER BY created_at DESC`,
    id,
  ).catch(() => []);

  const conversations = await prisma.$queryRawUnsafe<Array<{
    id: string; channel_type: string; status: string; subject: string | null;
    created_at: Date; closed_at: Date | null;
  }>>(
    `SELECT id, channel_type, status, subject, created_at, closed_at
     FROM ${schema}.conversations
     WHERE assigned_to = $1::uuid
     ORDER BY created_at DESC`,
    id,
  ).catch(() => []);

  const auditLogs = options.includeAuditLogs
    ? await prisma.$queryRawUnsafe<Array<{
      id: string; action: string; entity: string; entity_id: string | null; created_at: Date;
    }>>(
      `SELECT id, action, entity, entity_id, created_at
       FROM ${schema}.audit_logs
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 500`,
      id,
    ).catch(() => [])
    : [];

  const lgpdRequests = await prisma.$queryRawUnsafe<Array<{
    id: string; request_type: string; status: string;
    requested_by: string | null; processed_by: string | null;
    payload: unknown; result: unknown;
    requested_at: Date; processed_at: Date | null;
  }>>(
    `SELECT id, request_type, status, requested_by, processed_by, payload, result, requested_at, processed_at
     FROM ${schema}.lgpd_requests
     WHERE user_id = $1::uuid
     ORDER BY requested_at DESC
     LIMIT 100`,
    id,
  ).catch(() => []);

  await prisma.$executeRawUnsafe(
    `UPDATE ${usersRef} SET lgpd_last_export_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
    id,
  );

  const request = await createLgpdRequestRecord(
    {
      subjectType: 'user',
      subjectId: id,
      requestType: 'access',
      actorUserId,
      payload: { include_audit_logs: options.includeAuditLogs },
      result: {
        tickets: tickets.length,
        conversations: conversations.length,
        audit_logs: auditLogs.length,
        lgpd_requests: lgpdRequests.length,
      },
    },
    prisma,
    schemaName,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'user.lgpd.exported', 'user', $2::uuid, $3::jsonb)`,
    actorUserId,
    id,
    JSON.stringify({
      include_audit_logs: options.includeAuditLogs,
      exported_at: exportedAtIso,
      lgpd_request_id: request.id,
    }),
  );

  const events = auditLogs.map((log) => ({
    id: log.id,
    action: log.action,
    entity: log.entity,
    entity_id: log.entity_id,
    created_at: log.created_at.toISOString(),
    actor_user_id: id,
    data: {},
  }));

  const legacyAuditTrail = {
    requests: lgpdRequests.map((lgpdRequest) => ({
      id: lgpdRequest.id,
      request_type: lgpdRequest.request_type,
      status: lgpdRequest.status,
      requested_at: lgpdRequest.requested_at.toISOString(),
      processed_at: lgpdRequest.processed_at?.toISOString() ?? null,
      requested_by: lgpdRequest.requested_by,
      processed_by: lgpdRequest.processed_by,
      payload: lgpdRequest.payload,
      result: lgpdRequest.result,
    })),
    events,
  };

  const payload = {
    schema_version: LGPD_EXPORT_SCHEMA_VERSION,
    generated_at: exportedAtIso,
    exported_at: exportedAtIso,
    request_id: request.id,
    exported_by: {
      user_id: actor?.id ?? actorUserId,
      name: actor?.name ?? null,
      email: actor?.email ?? null,
    },
    subject: {
      type: 'user',
      subject_type: 'user',
      id: user.id,
      name: user.name,
      email: user.email,
      phone: null,
      document: null,
      created_at: user.created_at.toISOString(),
      updated_at: user.last_seen_at?.toISOString() ?? user.created_at.toISOString(),
    },
    consent: {
      status: user.lgpd_consent_status,
      consent_at: user.lgpd_consent_at?.toISOString() ?? null,
      consent_source: user.lgpd_consent_source,
      history: [{
        status: user.lgpd_consent_status,
        consent_at: user.lgpd_consent_at?.toISOString() ?? null,
        consent_source: user.lgpd_consent_source,
      }],
      source: user.lgpd_consent_source,
      updated_at: user.lgpd_consent_at?.toISOString() ?? null,
      last_export_at: exportedAtIso,
      anonymized_at: user.lgpd_anonymized_at?.toISOString() ?? null,
      anonymization_reason: user.lgpd_anonymization_reason,
    },
    contacts: [],
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      channel_type: conversation.channel_type,
      status: conversation.status,
      subject: conversation.subject,
      last_message: null,
      created_at: conversation.created_at.toISOString(),
      closed_at: conversation.closed_at?.toISOString() ?? null,
      messages: [],
    })),
    messages: [],
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      created_at: ticket.created_at.toISOString(),
    })),
    audit_trail: legacyAuditTrail,
    metadata: {
      tenant_id: tenant?.id ?? null,
      tenant_name: tenant?.name ?? null,
      data_controller: tenantPrivacy.dataController ?? tenant?.name ?? null,
      data_processor: tenantPrivacy.dataProcessor ?? 'ZiraDesk',
    },
  };

  const validation = validateExportPayload(payload);
  if (!validation.valid) {
    const message = `Payload de exportação LGPD inválido: ${validation.errors.join('; ')}`;
    if (process.env.NODE_ENV === 'production') {
      logger.warn({ userId: id, validationErrors: validation.errors }, '[LGPD] Export payload inválido para usuário');
    } else {
      throw new Error(message);
    }
  }
  return payload;
}

export async function anonymizeUserForLgpd(
  id: string,
  actorUserId: string,
  input: AnonymizeUserLgpdInput,
  requesterId: string,
  schemaName: string,
) {
  const schema = quoteIdent(schemaName);
  const usersRef = usersTable(schemaName);

  const existing = await getUser(id, schemaName);

  if (existing.role === 'owner') {
    throw new ForbiddenError('Não é possível anonimizar o proprietário da conta');
  }
  if (id === requesterId) {
    throw new ForbiddenError('Não é possível anonimizar a si mesmo');
  }

  const anonymizedName = `Usuário anonimizado ${id.slice(0, 8)}`;
  const anonymizedEmail = `anon-${id.slice(0, 8)}@anonimizado.invalid`;
  const reason = input.reason?.trim() || 'Solicitação LGPD';

  const rows = await prisma.$queryRawUnsafe<UserLgpdRow[]>(
    `UPDATE ${usersRef} SET
       name = $1,
       email = $2,
       phone = NULL,
       bio = NULL,
       avatar_url = NULL,
       status = 'inactive',
       password_hash = 'ANONIMIZADO',
       lgpd_consent_status = 'revoked',
       lgpd_consent_source = 'lgpd_anonymization',
       lgpd_consent_at = NOW(),
       lgpd_anonymized_at = NOW(),
       lgpd_anonymization_reason = $3,
       updated_at = NOW()
     WHERE id = $4::uuid
     RETURNING *`,
    anonymizedName,
    anonymizedEmail,
    reason,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Usuário');

  const updated = rows[0];

  await redis.del(`refresh:${id}`).catch(() => {});
  const forcedLogoutAt = Math.floor(Date.now() / 1000).toString();
  await redis.set(`auth:force_logout_after:${id}`, forcedLogoutAt, 'EX', 60 * 60 * 24 * 30).catch(() => {});

  const request = await createLgpdRequestRecord(
    {
      subjectType: 'user',
      subjectId: id,
      requestType: 'anonymization',
      actorUserId,
      payload: { reason, requested_by: actorUserId },
      result: { anonymized_at: updated.lgpd_anonymized_at?.toISOString() ?? null },
    },
    prisma,
    schemaName,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
     VALUES ($1::uuid, 'user.lgpd.anonymized', 'user', $2::uuid, $3::jsonb, $4::jsonb)`,
    actorUserId,
    id,
    JSON.stringify(existing),
    JSON.stringify({
      id: updated.id,
      name: updated.name,
      lgpd_anonymized_at: updated.lgpd_anonymized_at,
      lgpd_request_id: request.id,
    }),
  );

  return { user: updated, request };
}

export async function listUserLgpdRequests(
  query: ListUserLgpdRequestsQuery,
  schemaName: string,
) {
  const schema = quoteIdent(schemaName);
  const { page, per_page, user_id, request_type, status } = query;
  const offset = (page - 1) * per_page;

  const data = await prisma.$queryRawUnsafe<UserLgpdRequestRow[]>(
    `SELECT
       lr.id,
       lr.user_id,
       u.name AS user_name,
       lr.subject_type,
       lr.request_type,
       lr.status,
       lr.requested_by,
       ru.name AS requested_by_name,
       lr.processed_by,
       pu.name AS processed_by_name,
       lr.payload,
       lr.result,
       lr.requested_at,
       lr.processed_at
     FROM ${schema}.lgpd_requests lr
     LEFT JOIN ${schema}.users u ON u.id = lr.user_id
     LEFT JOIN ${schema}.users ru ON ru.id = lr.requested_by
     LEFT JOIN ${schema}.users pu ON pu.id = lr.processed_by
     WHERE lr.subject_type = 'user'
       AND ($1::uuid IS NULL OR lr.user_id = $1::uuid)
       AND ($2::text IS NULL OR lr.request_type = $2::text)
       AND ($3::text IS NULL OR lr.status = $3::text)
     ORDER BY lr.requested_at DESC
     LIMIT $4 OFFSET $5`,
    user_id ?? null,
    request_type ?? null,
    status ?? null,
    per_page,
    offset,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count
     FROM ${schema}.lgpd_requests lr
     WHERE lr.subject_type = 'user'
       AND ($1::uuid IS NULL OR lr.user_id = $1::uuid)
       AND ($2::text IS NULL OR lr.request_type = $2::text)
       AND ($3::text IS NULL OR lr.status = $3::text)`,
    user_id ?? null,
    request_type ?? null,
    status ?? null,
  );

  const total = Number(countRows[0]?.count ?? 0);
  return {
    data,
    meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
  };
}

export async function getUserLgpdState(id: string, schemaName: string) {
  const user = await getUser(id, schemaName);
  return {
    consent: {
      status: user.lgpd_consent_status,
      updated_at: user.lgpd_consent_at,
      source: user.lgpd_consent_source,
      last_export_at: user.lgpd_last_export_at,
      anonymized_at: user.lgpd_anonymized_at,
    },
  };
}

export async function submitUserAnonymizeRequest(
  userId: string,
  reason: string | undefined,
  schemaName: string,
) {
  const schema = quoteIdent(schemaName);
  const user = await getUser(userId, schemaName);

  if (user.role === 'owner') {
    throw new ForbiddenError('Proprietário do tenant não pode solicitar anonimização desta forma. Entre em contato com o suporte.');
  }

  const request = await createLgpdRequestRecord(
    {
      subjectType: 'user',
      subjectId: userId,
      requestType: 'anonymization',
      actorUserId: userId,
      payload: { reason: reason ?? 'Solicitação do próprio usuário', self_service: true },
      result: {},
      status: 'pending',
    },
    prisma,
    schemaName,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${schema}.audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'user.lgpd.anonymize_requested', 'user', $2::uuid, $3::jsonb)`,
    userId,
    userId,
    JSON.stringify({ reason: reason ?? 'Solicitação do próprio usuário', request_id: request.id }),
  );

  return request;
}
