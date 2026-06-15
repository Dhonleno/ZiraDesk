import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { sendEmail } from '../../services/email.service.js';
import {
  renderRequestReceived,
  renderRequestProcessed,
  renderRequestRejected,
  renderTenantNewRequest,
  renderSlaWarning,
  renderSlaBreached,
} from './emails/index.js';

type Lang = 'pt-BR' | 'en-US' | 'es';

interface PendingRequestRow {
  id: string;
  contact_id: string | null;
  user_id: string | null;
  subject_type: string;
  request_type: string;
  status: string;
  requested_at: Date;
  processed_at: Date | null;
  sla_deadline: Date | null;
  notified_at: Date | null;
  reminder_sent_at: Date | null;
  contact_email: string | null;
  contact_name: string | null;
  user_email: string | null;
  user_name: string | null;
}

interface TenantAdminRow {
  id: string;
  email: string;
  name: string;
}

interface TenantRow {
  id: string;
  schema_name: string;
  name: string;
  settings: unknown;
}

function safeName(schemaName: string): string {
  return schemaName.replace(/"/g, '""');
}

function tenantLanguage(tenant: TenantRow): Lang {
  const settings = (tenant.settings as Record<string, unknown>) ?? {};
  const lang = settings['language'];
  if (lang === 'en-US' || lang === 'es') return lang;
  return 'pt-BR';
}

function dashboardUrl(tenantSlug?: string): string {
  const base = env.APP_URL ?? 'https://app.ziradesk.com';
  return tenantSlug ? `${base}/admin/lgpd` : `${base}/admin/lgpd`;
}

function subjectLabelFor(row: PendingRequestRow): string {
  if (row.subject_type === 'contact') return row.contact_name ?? row.contact_email ?? 'Contato';
  if (row.subject_type === 'user') return row.user_name ?? row.user_email ?? 'Usuário';
  return 'ID externo';
}

// ─── Find admins in tenant schema ────────────────────────────────────────────

async function findTenantAdmins(schemaName: string): Promise<TenantAdminRow[]> {
  const safe = safeName(schemaName);
  return prisma.$queryRawUnsafe<TenantAdminRow[]>(
    `SELECT id, email, name
     FROM "${safe}".users
     WHERE role IN ('owner', 'admin')
       AND status = 'active'
       AND email IS NOT NULL`,
  );
}

// ─── Insert audit_log notification for in-app display ────────────────────────

async function insertInAppNotification(
  schemaName: string,
  action: string,
  entityId: string,
  assignedToUserId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const safe = safeName(schemaName);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${safe}".audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES (NULL, $1, 'lgpd_request', $2::uuid, $3::jsonb)`,
    action,
    entityId,
    JSON.stringify({ assigned_to: assignedToUserId, ...data }),
  );
}

// ─── Fetch pending requests needing processing for a tenant ──────────────────

async function fetchPendingRequests(schemaName: string): Promise<PendingRequestRow[]> {
  const safe = safeName(schemaName);
  return prisma.$queryRawUnsafe<PendingRequestRow[]>(
    `SELECT
       lr.id, lr.contact_id, lr.user_id, lr.subject_type, lr.request_type, lr.status,
       lr.requested_at, lr.processed_at, lr.sla_deadline, lr.notified_at, lr.reminder_sent_at,
       c.email AS contact_email, c.name AS contact_name,
       u.email AS user_email, u.name AS user_name
     FROM "${safe}".lgpd_requests lr
     LEFT JOIN "${safe}".contacts c ON c.id = lr.contact_id
     LEFT JOIN "${safe}".users u ON u.id = lr.user_id
     WHERE lr.status = 'pending'`,
  );
}

// ─── Mark fields on a request ─────────────────────────────────────────────────

async function markNotified(schemaName: string, requestId: string): Promise<void> {
  const safe = safeName(schemaName);
  await prisma.$executeRawUnsafe(
    `UPDATE "${safe}".lgpd_requests SET notified_at = NOW() WHERE id = $1::uuid`,
    requestId,
  );
}

async function markReminderSent(schemaName: string, requestId: string): Promise<void> {
  const safe = safeName(schemaName);
  await prisma.$executeRawUnsafe(
    `UPDATE "${safe}".lgpd_requests SET reminder_sent_at = NOW() WHERE id = $1::uuid`,
    requestId,
  );
}

export async function markSubjectNotified(schemaName: string, requestId: string): Promise<void> {
  await markNotified(schemaName, requestId);
}

async function fetchTenantNotifiedRequestIds(
  schemaName: string,
  requestIds: string[],
): Promise<Set<string>> {
  if (!requestIds.length) return new Set<string>();
  const safe = safeName(schemaName);
  const rows = await prisma.$queryRawUnsafe<Array<{ request_id: string }>>(
    `SELECT DISTINCT entity_id::text AS request_id
     FROM "${safe}".audit_logs
     WHERE action = 'lgpd.request.received'
       AND entity_id = ANY($1::uuid[])`,
    requestIds,
  );
  return new Set(rows.map((row) => row.request_id));
}

// ─── Notify tenant of a new pending request ───────────────────────────────────

async function notifyTenantNewRequest(
  tenant: TenantRow,
  request: PendingRequestRow,
): Promise<void> {
  const lang = tenantLanguage(tenant);
  const admins = await findTenantAdmins(tenant.schema_name);
  if (!admins.length) return;

  const email = renderTenantNewRequest({
    requestId: request.id,
    subjectLabel: subjectLabelFor(request),
    requestType: request.request_type,
    requestedAt: request.requested_at,
    slaDeadline: request.sla_deadline ?? new Date(request.requested_at.getTime() + 15 * 86400_000),
    dashboardUrl: dashboardUrl(),
    lang,
  });

  for (const admin of admins) {
    try {
      await sendEmail({
        tenantId: tenant.id,
        tenantSchema: tenant.schema_name,
        to: admin.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (err) {
      logger.warn(
        { tenantId: tenant.id, adminId: admin.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to email admin for new request',
      );
    }

    try {
      await insertInAppNotification(tenant.schema_name, 'lgpd.request.received', request.id, admin.id, {
        request_type: request.request_type,
        subject_label: subjectLabelFor(request),
        sla_deadline: request.sla_deadline?.toISOString(),
      });
    } catch (err) {
      logger.warn(
        { tenantId: tenant.id, adminId: admin.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to insert in-app notification for new request',
      );
    }
  }

}

// ─── Notify data subject of received request ──────────────────────────────────

export async function notifySubjectRequestReceived(
  tenant: TenantRow,
  request: PendingRequestRow & { sla_deadline: Date },
): Promise<void> {
  const subjectEmail = request.contact_email ?? request.user_email;
  if (!subjectEmail) return;

  const lang = tenantLanguage(tenant);
  const email = renderRequestReceived({
    tenantName: tenant.name,
    requestType: request.request_type,
    requestedAt: request.requested_at,
    slaDeadline: request.sla_deadline,
    lang,
  });

  try {
    await sendEmail({
      tenantId: tenant.id,
      tenantSchema: tenant.schema_name,
      to: subjectEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (err) {
    logger.warn(
      { tenantId: tenant.id, requestId: request.id, err: err instanceof Error ? err.message : String(err) },
      '[LGPD SLA] Failed to email subject (request received)',
    );
  }
}

// ─── Notify data subject that request was processed ───────────────────────────

export async function notifySubjectRequestProcessed(params: {
  tenant: TenantRow;
  schemaName: string;
  requestId: string;
  requestType: string;
  processedAt: Date;
  subjectEmail: string | null;
  notes?: string | undefined;
  lang?: Lang | undefined;
}): Promise<void> {
  if (!params.subjectEmail) return;

  const renderParams = {
    tenantName: params.tenant.name,
    requestType: params.requestType,
    processedAt: params.processedAt,
    lang: params.lang ?? tenantLanguage(params.tenant),
    ...(params.notes !== undefined ? { notes: params.notes } : {}),
  };
  const email = renderRequestProcessed(renderParams);

  try {
    await sendEmail({
      tenantId: params.tenant.id,
      tenantSchema: params.schemaName,
      to: params.subjectEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    await markSubjectNotified(params.schemaName, params.requestId);
  } catch (err) {
    logger.warn(
      { tenantId: params.tenant.id, requestId: params.requestId, err: err instanceof Error ? err.message : String(err) },
      '[LGPD SLA] Failed to email subject (request processed)',
    );
  }
}

// ─── Notify data subject that request was rejected ────────────────────────────

export async function notifySubjectRequestRejected(params: {
  tenant: TenantRow;
  schemaName: string;
  requestId: string;
  requestType: string;
  rejectedAt: Date;
  reason: string;
  subjectEmail: string | null;
  lang?: Lang | undefined;
}): Promise<void> {
  if (!params.subjectEmail) return;

  const email = renderRequestRejected({
    tenantName: params.tenant.name,
    requestType: params.requestType,
    rejectedAt: params.rejectedAt,
    reason: params.reason,
    lang: params.lang ?? tenantLanguage(params.tenant),
  });

  try {
    await sendEmail({
      tenantId: params.tenant.id,
      tenantSchema: params.schemaName,
      to: params.subjectEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (err) {
    logger.warn(
      { tenantId: params.tenant.id, requestId: params.requestId, err: err instanceof Error ? err.message : String(err) },
      '[LGPD SLA] Failed to email subject (request rejected)',
    );
  }
}

// ─── Send SLA reminder ────────────────────────────────────────────────────────

async function sendSlaReminder(tenant: TenantRow, request: PendingRequestRow, daysLeft: number): Promise<void> {
  const lang = tenantLanguage(tenant);
  const admins = await findTenantAdmins(tenant.schema_name);
  if (!admins.length) return;

  const email = renderSlaWarning({
    requestId: request.id,
    subjectLabel: subjectLabelFor(request),
    requestType: request.request_type,
    daysLeft,
    slaDeadline: request.sla_deadline!,
    dashboardUrl: dashboardUrl(),
    lang,
  });

  for (const admin of admins) {
    try {
      await sendEmail({
        tenantId: tenant.id,
        tenantSchema: tenant.schema_name,
        to: admin.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (err) {
      logger.warn(
        { tenantId: tenant.id, adminId: admin.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to email admin reminder',
      );
    }

    try {
      await insertInAppNotification(tenant.schema_name, 'lgpd.sla.warning', request.id, admin.id, {
        days_left: daysLeft,
        request_type: request.request_type,
        subject_label: subjectLabelFor(request),
        sla_deadline: request.sla_deadline?.toISOString(),
      });
    } catch (err) {
      logger.warn(
        { tenantId: tenant.id, adminId: admin.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to insert in-app reminder',
      );
    }
  }

  await markReminderSent(tenant.schema_name, request.id);
}

// ─── Alert SLA breach ─────────────────────────────────────────────────────────

async function alertSlaBreached(tenant: TenantRow, breachedRequests: PendingRequestRow[]): Promise<void> {
  const lang = tenantLanguage(tenant);
  const admins = await findTenantAdmins(tenant.schema_name);

  const email = renderSlaBreached({
    tenantName: tenant.name,
    pendingCount: breachedRequests.length,
    dashboardUrl: dashboardUrl(),
    lang,
  });

  // Notify tenant admins
  for (const admin of admins) {
    try {
      await sendEmail({
        tenantId: tenant.id,
        tenantSchema: tenant.schema_name,
        to: admin.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (err) {
      logger.warn(
        { tenantId: tenant.id, adminId: admin.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to email admin breach alert',
      );
    }
  }

  // Alert super admin if configured
  const superAdminEmail = env.SUPER_ADMIN_EMAIL;
  if (superAdminEmail) {
    const breachEmail = renderSlaBreached({
      tenantName: tenant.name,
      pendingCount: breachedRequests.length,
      dashboardUrl: dashboardUrl(),
      lang: 'pt-BR',
    });
    try {
      await sendEmail({
        tenantId: tenant.id,
        tenantSchema: tenant.schema_name,
        to: superAdminEmail,
        subject: `[Super Admin] ${breachEmail.subject}`,
        html: breachEmail.html,
        text: breachEmail.text,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to alert super admin of breach',
      );
    }
  }

  // In-app alerts for each breached request
  for (const req of breachedRequests) {
    for (const admin of admins) {
      try {
        await insertInAppNotification(tenant.schema_name, 'lgpd.sla.breached', req.id, admin.id, {
          request_type: req.request_type,
          subject_label: subjectLabelFor(req),
          sla_deadline: req.sla_deadline?.toISOString(),
        });
      } catch {
        // best effort
      }
    }
    await markReminderSent(tenant.schema_name, req.id);
  }
}

// ─── Main per-tenant SLA processing ──────────────────────────────────────────

export async function processTenantSla(tenant: TenantRow): Promise<void> {
  const pendingRequests = await fetchPendingRequests(tenant.schema_name);
  if (!pendingRequests.length) return;

  const now = Date.now();
  const tenantNotifiedRequestIds = await fetchTenantNotifiedRequestIds(
    tenant.schema_name,
    pendingRequests.map((request) => request.id),
  );

  const unnotified: PendingRequestRow[] = [];
  const d5Reminder: PendingRequestRow[] = [];
  const d1Reminder: PendingRequestRow[] = [];
  const breached: PendingRequestRow[] = [];

  for (const req of pendingRequests) {
    const deadline = req.sla_deadline
      ? req.sla_deadline.getTime()
      : req.requested_at.getTime() + 15 * 86400_000;
    const msLeft = deadline - now;
    const daysLeft = msLeft / 86400_000;
    const lastReminder = req.reminder_sent_at?.getTime() ?? 0;
    const reminderAge = (now - lastReminder) / 3600_000; // hours

    if (!tenantNotifiedRequestIds.has(req.id)) {
      unnotified.push(req);
    }

    if (msLeft < 0) {
      // First breach alert should trigger as soon as deadline passes.
      // Subsequent breach alerts are throttled to ~6h.
      const sentBeforeDeadline = lastReminder > 0 && lastReminder <= deadline;
      if (!lastReminder || sentBeforeDeadline || reminderAge >= 5.5) {
        breached.push(req);
      }
    } else if (daysLeft <= 1 && daysLeft >= 0) {
      // D-1: send if never reminded or last reminder > 3 days ago
      if (reminderAge >= 72) {
        d1Reminder.push(req);
      }
    } else if (daysLeft <= 5 && daysLeft > 1) {
      // D-5: send once (never reminded)
      if (!req.reminder_sent_at) {
        d5Reminder.push(req);
      }
    }
  }

  // Process new request notifications
  for (const req of unnotified) {
    try {
      await notifyTenantNewRequest(tenant, req);
      // Also notify subject of receipt
      if (req.sla_deadline) {
        await notifySubjectRequestReceived(tenant, req as PendingRequestRow & { sla_deadline: Date });
      }
    } catch (err) {
      logger.error(
        { tenantId: tenant.id, requestId: req.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to process new request notification',
      );
    }
  }

  // D-5 reminders
  for (const req of d5Reminder) {
    try {
      await sendSlaReminder(tenant, req, 5);
    } catch (err) {
      logger.error(
        { tenantId: tenant.id, requestId: req.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to send D-5 reminder',
      );
    }
  }

  // D-1 reminders
  for (const req of d1Reminder) {
    try {
      await sendSlaReminder(tenant, req, 1);
    } catch (err) {
      logger.error(
        { tenantId: tenant.id, requestId: req.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to send D-1 reminder',
      );
    }
  }

  // Breach alerts (group all breached requests in one email)
  if (breached.length > 0) {
    try {
      await alertSlaBreached(tenant, breached);
    } catch (err) {
      logger.error(
        { tenantId: tenant.id, count: breached.length, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to send breach alert',
      );
    }
  }
}

// ─── Full scan across all active tenants ─────────────────────────────────────

export async function runLgpdSlaScan(): Promise<void> {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name, name, settings
     FROM tenants
     WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    try {
      await processTenantSla(tenant);
    } catch (err) {
      logger.error(
        { tenantId: tenant.id, err: err instanceof Error ? err.message : String(err) },
        '[LGPD SLA] Failed to scan tenant',
      );
    }
  }
}
