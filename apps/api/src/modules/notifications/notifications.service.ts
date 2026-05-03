import { prisma } from '../../config/database.js';
import { quoteIdent } from '../omnichannel/conversations/protocols.js';

type NotificationType = 'ticket_assigned' | 'conversation_assigned' | 'ticket_comment' | 'conversation_message';

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
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  created_at: Date;
  href: string;
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
    };
  }

  if (row.action === 'conversation.message') {
    const label = row.contact_name ?? row.conversation_subject ?? 'Cliente';
    const preview = String((row.new_data as Record<string, unknown>)?.['preview'] ?? 'Nova mensagem recebida');
    return {
      id: row.id,
      type: 'conversation_message',
      title: `Nova mensagem de ${label}`,
      message: preview,
      read: row.read,
      created_at: row.created_at,
      href: `/omnichannel/conversations?conversation=${row.entity_id ?? ''}`,
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
  };
}

export async function listNotifications(userId: string, schemaName: string) {
  await ensureAuditLogsTable(schemaName);
  await ensureNotificationReadsTable(schemaName);
  const auditLogsRef = tableRef(schemaName, 'audit_logs');
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');
  const ticketsRef = tableRef(schemaName, 'tickets');
  const conversationsRef = tableRef(schemaName, 'conversations');
  const contactsRef = tableRef(schemaName, 'contacts');

  const rows = await prisma.$queryRawUnsafe<NotificationRow[]>(
    `SELECT
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
       ON c.id = CASE WHEN al.action = 'conversation.assigned' THEN al.entity_id ELSE NULL END
     LEFT JOIN ${contactsRef} ct ON ct.id = c.contact_id
     WHERE (
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
     )
     ORDER BY al.created_at DESC
     LIMIT 20`,
    userId,
  );

  return rows.map(toNotification);
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

export async function markAllNotificationsRead(userId: string, schemaName: string) {
  await ensureAuditLogsTable(schemaName);
  await ensureNotificationReadsTable(schemaName);
  const notifications = await listNotifications(userId, schemaName);
  if (notifications.length === 0) return { read: 0 };
  const notificationReadsRef = tableRef(schemaName, 'notification_reads');
  const auditLogsRef = tableRef(schemaName, 'audit_logs');

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${notificationReadsRef} (user_id, notification_id)
     SELECT $1::uuid, id
     FROM ${auditLogsRef}
     WHERE id = ANY($2::uuid[])
     ON CONFLICT (user_id, notification_id) DO NOTHING`,
    userId,
    notifications.map((n) => n.id),
  );

  return { read: notifications.length };
}
