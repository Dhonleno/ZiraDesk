import { prisma } from '../../config/database.js';
import { quoteIdent } from '../omnichannel/conversations/protocols.js';

type NotificationType =
  | 'ticket_assigned'
  | 'conversation_assigned'
  | 'ticket_comment'
  | 'conversation_message'
  | 'message_failed'
  | 'help_requested'
  | 'lgpd_request_received'
  | 'lgpd_sla_warning'
  | 'lgpd_sla_breached';

interface NotificationRow {
  id: string;
  action: string;
  entity_id: string | null;
  new_data: Record<string, unknown> | null;
  created_at: Date;
  read: boolean;
  ticket_title: string | null;
  conversation_subject: string | null;
  contact_name: string | null;
  total_count: number;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  created_at: Date;
  href: string;
  data?: Record<string, unknown>;
}

export interface NotificationListMeta {
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface NotificationListResult {
  data: NotificationItem[];
  meta: NotificationListMeta;
}

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

async function ensureNotificationReadsTable(schemaName: string) {
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${notificationReadsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      notification_id UUID NOT NULL,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, notification_id)
    )
  `);
}

async function ensureAuditLogsTable(schemaName: string) {
  const auditLogsRef = tableRef(schemaName, 'audit_logs');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${auditLogsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NULL,
      action TEXT NOT NULL,
      entity TEXT NULL,
      entity_id UUID NULL,
      old_data JSONB NULL,
      new_data JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function toNotification(row: NotificationRow): NotificationItem {
  if (row.action === 'ticket.assigned') {
    return {
      id: row.id,
      type: 'ticket_assigned',
      title: 'Ticket atribuído',
      message: row.ticket_title ? `Você recebeu o ticket "${row.ticket_title}".` : 'Você recebeu um novo ticket.',
      read: row.read,
      created_at: row.created_at,
      href: `/tickets/${row.entity_id ?? ''}`,
      data: {
        ...(row.new_data ?? {}),
        title: row.ticket_title,
      },
    };
  }

  if (row.action === 'conversation.assigned') {
    const label = row.contact_name ?? row.conversation_subject ?? 'conversa';
    return {
      id: row.id,
      type: 'conversation_assigned',
      title: 'Conversa atribuída',
      message: `Você recebeu ${label}.`,
      read: row.read,
      created_at: row.created_at,
      href: `/omnichannel/conversations?conversation=${row.entity_id ?? ''}`,
      data: {
        ...(row.new_data ?? {}),
        contact_name: label,
      },
    };
  }

  if (row.action === 'conversation.message') {
    const payload = row.new_data ?? {};
    const label = String(payload['contact_name'] ?? row.contact_name ?? row.conversation_subject ?? 'Cliente');
    const preview = String((row.new_data as Record<string, unknown>)?.['preview'] ?? 'Nova mensagem recebida');
    return {
      id: row.id,
      type: 'conversation_message',
      title: `Nova mensagem de ${label}`,
      message: preview,
      read: row.read,
      created_at: row.created_at,
      href: `/omnichannel/conversations?conversation=${row.entity_id ?? ''}`,
      data: {
        ...(row.new_data ?? {}),
        contact_name: label,
        preview,
      },
    };
  }

  if (row.action === 'message.failed') {
    const payload = row.new_data ?? {};
    const reason = String(payload['reason'] ?? 'Falha desconhecida');
    const body = String(payload['body'] ?? `Falha no envio: ${reason}`);
    return {
      id: row.id,
      type: 'message_failed',
      title: 'Mensagem não entregue',
      message: body,
      read: row.read,
      created_at: row.created_at,
      href: `/omnichannel/conversations?conversation=${row.entity_id ?? ''}`,
      data: {
        ...(row.new_data ?? {}),
        reason,
      },
    };
  }

  if (row.action === 'help.requested') {
    const payload = row.new_data ?? {};
    const requesterName = String(payload['agent_name'] ?? 'Agente');
    return {
      id: row.id,
      type: 'help_requested',
      title: 'Pedido de ajuda',
      message: `${requesterName} precisa de ajuda`,
      read: row.read,
      created_at: row.created_at,
      href: `/omnichannel/conversations?conversation=${row.entity_id ?? ''}`,
      data: {
        ...(row.new_data ?? {}),
        agent_name: requesterName,
      },
    };
  }

  if (row.action === 'lgpd.request.received') {
    const payload = row.new_data ?? {};
    const subject = String(payload['subject_label'] ?? 'Titular');
    const requestType = String(payload['request_type'] ?? 'solicitação');
    return {
      id: row.id,
      type: 'lgpd_request_received',
      title: 'Nova solicitação LGPD',
      message: `Solicitação de ${requestType} recebida de ${subject}.`,
      read: row.read,
      created_at: row.created_at,
      href: '/admin/lgpd',
      data: row.new_data ?? {},
    };
  }

  if (row.action === 'lgpd.sla.warning') {
    const payload = row.new_data ?? {};
    const daysLeft = Number(payload['days_left'] ?? 0);
    const subject = String(payload['subject_label'] ?? 'Titular');
    return {
      id: row.id,
      type: 'lgpd_sla_warning',
      title: `⚠️ Prazo LGPD: ${daysLeft} dia(s)`,
      message: `Solicitação de ${subject} vence em ${daysLeft} dia(s).`,
      read: row.read,
      created_at: row.created_at,
      href: '/admin/lgpd',
      data: row.new_data ?? {},
    };
  }

  if (row.action === 'lgpd.sla.breached') {
    const payload = row.new_data ?? {};
    const subject = String(payload['subject_label'] ?? 'Titular');
    return {
      id: row.id,
      type: 'lgpd_sla_breached',
      title: '🚨 SLA LGPD estourado',
      message: `Solicitação de ${subject} com prazo legal expirado.`,
      read: row.read,
      created_at: row.created_at,
      href: '/admin/lgpd',
      data: row.new_data ?? {},
    };
  }

  const ticketId = String(row.new_data?.['ticket_id'] ?? '');
  return {
    id: row.id,
    type: 'ticket_comment',
    title: 'Novo comentário',
    message: row.ticket_title ? `Novo comentário em "${row.ticket_title}".` : 'Novo comentário em um ticket.',
    read: row.read,
    created_at: row.created_at,
    href: `/tickets/${ticketId}`,
    data: {
      ...(row.new_data ?? {}),
      title: row.ticket_title,
    },
  };
}

function clampPage(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function clampPerPage(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 20;
  return Math.min(Math.floor(value), 100);
}

function notificationsWhereClause(): string {
  return `(
    al.action = 'ticket.assigned'
    AND al.new_data->>'assigned_to' = $1
  ) OR (
    al.action = 'conversation.assigned'
    AND al.new_data->>'assigned_to' = $1
  ) OR (
    al.action = 'ticket.comment_added'
    AND t.assigned_to = $1::uuid
    AND (al.user_id IS NULL OR al.user_id <> $1::uuid)
  ) OR (
    al.action = 'conversation.message'
    AND al.new_data->>'assigned_to' = $1
  ) OR (
    al.action = 'message.failed'
    AND al.new_data->>'assigned_to' = $1
  ) OR (
    al.action = 'help.requested'
    AND al.new_data->>'assigned_to' = $1
  ) OR (
    al.action IN ('lgpd.request.received', 'lgpd.sla.warning', 'lgpd.sla.breached')
    AND al.new_data->>'assigned_to' = $1
  )`;
}

export async function listNotifications(
  userId: string,
  schemaName: string,
  page = 1,
  perPage = 20,
): Promise<NotificationListResult> {
  await ensureAuditLogsTable(schemaName);
  await ensureNotificationReadsTable(schemaName);
  const auditLogsRef = tableRef(schemaName, 'audit_logs');
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');
  const ticketsRef = tableRef(schemaName, 'tickets');
  const conversationsRef = tableRef(schemaName, 'conversations');
  const contactsRef = tableRef(schemaName, 'contacts');
  const safePage = clampPage(page);
  const safePerPage = clampPerPage(perPage);
  const offset = (safePage - 1) * safePerPage;

  const rows = await prisma.$queryRawUnsafe<NotificationRow[]>(
    `SELECT
       COUNT(*) OVER()::integer AS total_count,
       al.id,
       al.action,
       al.entity_id,
       al.new_data,
       al.created_at,
       (nr.notification_id IS NOT NULL) AS read,
       t.title AS ticket_title,
       c.subject AS conversation_subject,
       ct.name AS contact_name
     FROM ${auditLogsRef} al
     LEFT JOIN ${notificationReadsRef} nr
       ON nr.notification_id = al.id AND nr.user_id = $1::uuid
     LEFT JOIN ${ticketsRef} t
       ON t.id = CASE
         WHEN al.action = 'ticket.assigned' THEN al.entity_id
         WHEN al.action = 'ticket.comment_added' THEN (al.new_data->>'ticket_id')::uuid
         ELSE NULL
       END
     LEFT JOIN ${conversationsRef} c
       ON c.id = CASE
         WHEN al.action IN ('conversation.assigned', 'conversation.message', 'message.failed', 'help.requested') THEN al.entity_id
         ELSE NULL
       END
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     WHERE ${notificationsWhereClause()}
     ORDER BY al.created_at DESC
     LIMIT $2
     OFFSET $3`,
    userId,
    safePerPage,
    offset,
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    data: rows.map(toNotification),
    meta: {
      total,
      page: safePage,
      per_page: safePerPage,
      has_more: offset + safePerPage < total,
    },
  };
}

export async function markNotificationRead(userId: string, notificationId: string, schemaName: string) {
  await ensureAuditLogsTable(schemaName);
  await ensureNotificationReadsTable(schemaName);
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${notificationReadsRef} (user_id, notification_id)
     VALUES ($1::uuid, $2::uuid)
     ON CONFLICT (user_id, notification_id) DO NOTHING`,
    userId,
    notificationId,
  );
  return { read: true };
}

export async function markConversationNotificationsRead(userId: string, conversationId: string, schemaName: string) {
  await ensureAuditLogsTable(schemaName);
  await ensureNotificationReadsTable(schemaName);
  const auditLogsRef = tableRef(schemaName, 'audit_logs');
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');

  const rows = await prisma.$queryRawUnsafe<Array<{ notification_id: string }>>(
    `INSERT INTO ${notificationReadsRef} (user_id, notification_id)
     SELECT $1::uuid, al.id
     FROM ${auditLogsRef} al
     WHERE al.entity_id = $2::uuid
       AND al.action IN ('conversation.message', 'conversation.assigned')
       AND al.new_data->>'assigned_to' = $1
     ON CONFLICT (user_id, notification_id) DO NOTHING
     RETURNING notification_id`,
    userId,
    conversationId,
  );

  return { read: rows.length };
}

export async function markAllNotificationsRead(userId: string, schemaName: string) {
  await ensureAuditLogsTable(schemaName);
  await ensureNotificationReadsTable(schemaName);
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');
  const auditLogsRef = tableRef(schemaName, 'audit_logs');
  const ticketsRef = tableRef(schemaName, 'tickets');

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT al.id
     FROM ${auditLogsRef} al
     LEFT JOIN ${ticketsRef} t
       ON t.id = CASE
         WHEN al.action = 'ticket.assigned' THEN al.entity_id
         WHEN al.action = 'ticket.comment_added' THEN (al.new_data->>'ticket_id')::uuid
         ELSE NULL
       END
     WHERE ${notificationsWhereClause()}
     ORDER BY al.created_at DESC`,
    userId,
  );
  if (rows.length === 0) return { read: 0 };

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${notificationReadsRef} (user_id, notification_id)
     SELECT $1::uuid, id
     FROM ${auditLogsRef}
     WHERE id = ANY($2::uuid[])
     ON CONFLICT (user_id, notification_id) DO NOTHING`,
    userId,
    rows.map((row) => row.id),
  );

  return { read: rows.length };
}

export async function deleteNotification(userId: string, notificationId: string, schemaName: string) {
  await ensureAuditLogsTable(schemaName);
  await ensureNotificationReadsTable(schemaName);
  const auditLogsRef = tableRef(schemaName, 'audit_logs');
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');

  await prisma.$executeRawUnsafe(
    `DELETE FROM ${notificationReadsRef} WHERE notification_id = $1::uuid AND user_id = $2::uuid`,
    notificationId,
    userId,
  );

  await prisma.$executeRawUnsafe(
    `DELETE FROM ${auditLogsRef}
     WHERE id = $1::uuid
       AND (new_data->>'assigned_to' = $2 OR user_id = $2::uuid)`,
    notificationId,
    userId,
  );

  return { deleted: true };
}

export async function deleteAllReadNotifications(userId: string, schemaName: string) {
  await ensureAuditLogsTable(schemaName);
  await ensureNotificationReadsTable(schemaName);
  const auditLogsRef = tableRef(schemaName, 'audit_logs');
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');
  const ticketsRef = tableRef(schemaName, 'tickets');

  const readRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT al.id
     FROM ${auditLogsRef} al
     LEFT JOIN ${ticketsRef} t
       ON t.id = CASE
         WHEN al.action = 'ticket.assigned' THEN al.entity_id
         WHEN al.action = 'ticket.comment_added' THEN (al.new_data->>'ticket_id')::uuid
         ELSE NULL
       END
     WHERE ${notificationsWhereClause()}
       AND EXISTS (
         SELECT 1 FROM ${notificationReadsRef} nr
         WHERE nr.notification_id = al.id AND nr.user_id = $1::uuid
       )`,
    userId,
  );

  if (readRows.length === 0) return { deleted: 0 };

  const ids = readRows.map((row) => row.id);

  await prisma.$executeRawUnsafe(
    `DELETE FROM ${notificationReadsRef} WHERE notification_id = ANY($1::uuid[]) AND user_id = $2::uuid`,
    ids,
    userId,
  );

  await prisma.$executeRawUnsafe(
    `DELETE FROM ${auditLogsRef}
     WHERE id = ANY($1::uuid[])
       AND (new_data->>'assigned_to' = $2 OR user_id = $2::uuid)`,
    ids,
    userId,
  );

  return { deleted: readRows.length };
}
