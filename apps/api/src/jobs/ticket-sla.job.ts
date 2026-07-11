import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { bullmqConnection } from '../config/redis.js';
import { sendEmail } from '../services/email.service.js';
import { buildTenantUrl } from '../utils/url.js';

interface TicketSlaJobData {}

export interface TenantRow {
  id: string;
  schemaName: string;
  name: string;
  slug: string;
}

interface OverdueTicketRow {
  id: string;
  ticket_number: number;
  title: string;
  priority: string;
  assigned_to: string | null;
  created_by: string | null;
  contact_email: string | null;
  contact_name: string | null;
  due_date: Date;
  escalated: boolean;
  sla_paused_duration_seconds: number;
  assignee_email: string | null;
  assignee_name: string | null;
  creator_email: string | null;
  creator_name: string | null;
}

const QUEUE_NAME = 'ziradesk-ticket-sla';
const TICKET_SLA_JOB_ID = 'ticket-sla-every-1-hour';
const TICKET_SLA_EVERY_MS = 60 * 60 * 1000;

const PRIORITY_ESCALATION: Record<string, string> = {
  low: 'medium',
  medium: 'high',
  high: 'urgent',
  urgent: 'urgent',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

export const ticketSlaQueue = new Queue<TicketSlaJobData>(QUEUE_NAME, {
  connection: bullmqConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
});

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function hasColumn(schemaName: string, tableName: string, columnName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = $2
         AND column_name = $3
     ) AS "exists"`,
    schemaName,
    tableName,
    columnName,
  );
  return Boolean(rows[0]?.exists);
}

// Exportada (mesmo padrão de processTicketSlaWarningForTenant em
// ticket-sla-warning.job.ts) para permitir teste direto sem depender do BullMQ.
export async function processTicketSlaForTenant(tenant: TenantRow): Promise<void> {
  const schema = quoteIdent(tenant.schemaName);
  const hasCreatedBy = await hasColumn(tenant.schemaName, 'tickets', 'created_by');
  const createdBySelect = hasCreatedBy
    ? 't.created_by, uc.email AS creator_email, uc.name AS creator_name'
    : 'NULL::uuid AS created_by, NULL::text AS creator_email, NULL::text AS creator_name';
  const creatorJoin = hasCreatedBy
    ? `LEFT JOIN ${schema}.users uc ON uc.id = t.created_by`
    : '';

  const overdueTickets = await prisma.$queryRawUnsafe<OverdueTicketRow[]>(
    `SELECT
       t.id,
       t.ticket_number,
       t.title,
       t.priority,
       t.assigned_to,
       ${createdBySelect},
       t.due_date,
       t.escalated,
       t.sla_paused_duration_seconds,
       ct.email AS contact_email,
       ct.name AS contact_name,
       ua.email AS assignee_email,
       ua.name AS assignee_name
     FROM ${schema}.tickets t
     LEFT JOIN ${schema}.contacts ct ON ct.id = t.contact_id
     LEFT JOIN ${schema}.users ua ON ua.id = t.assigned_to
     ${creatorJoin}
     WHERE t.status NOT IN ('resolved', 'closed', 'canceled')
       AND t.due_date IS NOT NULL
       AND t.escalated = false
       AND t.sla_paused_at IS NULL
       AND (t.due_date + (t.sla_paused_duration_seconds || ' seconds')::interval) < NOW()`,
  );

  if (overdueTickets.length === 0) return;

  logger.info({ tenantId: tenant.id, count: overdueTickets.length }, '[TicketSLA] Overdue tickets found');

  for (const ticket of overdueTickets) {
    try {
      const newPriority = PRIORITY_ESCALATION[ticket.priority] ?? ticket.priority;
      const ticketUrl = buildTenantUrl(tenant.slug, `/portal/tickets/${ticket.id}`);
      const ticketNum = `#${String(ticket.ticket_number).padStart(5, '0')}`;

      await prisma.$executeRawUnsafe(
        `UPDATE ${schema}.tickets
         SET priority = $1,
             escalated = true,
             escalated_at = NOW(),
             updated_at = NOW()
         WHERE id = $2::uuid`,
        newPriority,
        ticket.id,
      );

      await prisma.$executeRawUnsafe(
        `INSERT INTO ${schema}.ticket_events
           (ticket_id, user_id, event_type, old_value, new_value, metadata)
         VALUES ($1::uuid, NULL, 'sla_breach', $2, $3, $4::jsonb)`,
        ticket.id,
        ticket.priority,
        newPriority,
        JSON.stringify({ reason: 'due_date_exceeded' }),
      );

      const recipients: string[] = [];
      if (ticket.assignee_email) recipients.push(ticket.assignee_email);
      if (ticket.creator_email && ticket.creator_email !== ticket.assignee_email) {
        recipients.push(ticket.creator_email);
      }

      if (recipients.length === 0) continue;

      const priorityChanged = newPriority !== ticket.priority;
      const html = buildSlaBreachEmail({
        ticketNum,
        ticketTitle: ticket.title,
        oldPriority: PRIORITY_LABEL[ticket.priority] ?? ticket.priority,
        newPriority: PRIORITY_LABEL[newPriority] ?? newPriority,
        priorityChanged,
        ticketUrl,
        tenantName: tenant.name,
      });

      await sendEmail({
        tenantId: tenant.id,
        tenantSchema: tenant.schemaName,
        to: recipients,
        subject: `SLA vencido: ${ticketNum} — ${ticket.title}`,
        html,
        from: { name: tenant.name },
      });

      logger.info({ tenantId: tenant.id, ticketId: ticket.id, ticketNum }, '[TicketSLA] Escalated ticket');
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, '[TicketSLA] Error escalating ticket');
    }
  }
}

function buildSlaBreachEmail(params: {
  ticketNum: string;
  ticketTitle: string;
  oldPriority: string;
  newPriority: string;
  priorityChanged: boolean;
  ticketUrl: string;
  tenantName: string;
}): string {
  const ticketNum = escapeHtml(params.ticketNum);
  const ticketTitle = escapeHtml(params.ticketTitle);
  const oldPriority = escapeHtml(params.oldPriority);
  const newPriority = escapeHtml(params.newPriority);
  const ticketUrl = escapeHtml(params.ticketUrl);
  const tenantName = escapeHtml(params.tenantName);
  const escalationNote = params.priorityChanged
    ? `<p>A prioridade foi automaticamente escalada de <strong>${oldPriority}</strong> para <strong style="color:#dc2626;">${newPriority}</strong>.</p>`
    : `<p>A prioridade já está no nível máximo (<strong>${oldPriority}</strong>) e não pode ser escalada automaticamente.</p>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;">
        <tr>
          <td style="background:#dc2626;padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">SLA vencido</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:#444444;font-size:15px;line-height:1.6;">
            <p>O prazo do seguinte ticket foi excedido:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
              <tr>
                <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:120px;">Protocolo</td>
                <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${ticketNum}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Assunto</td>
                <td style="padding:8px 12px;border:1px solid #e5e7eb;">${ticketTitle}</td>
              </tr>
            </table>
            ${escalationNote}
            <p style="text-align:center;margin:28px 0;">
              <a href="${ticketUrl}" style="background:#dc2626;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
                Ver ticket
              </a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;color:#9ca3af;font-size:12px;">
            Este alerta foi gerado automaticamente pelo ${tenantName} via ZiraDesk.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export const ticketSlaWorker = new Worker<TicketSlaJobData>(
  QUEUE_NAME,
  async () => {
    logger.info('[TicketSLA] Checking overdue tickets...');

    const tenants = await prisma.tenant.findMany({
      where: { status: { in: ['active', 'trial'] } },
      select: { id: true, schemaName: true, name: true, slug: true },
    });

    for (const tenant of tenants) {
      try {
        await processTicketSlaForTenant(tenant);
      } catch (err) {
        logger.error({ err, tenantId: tenant.id }, '[TicketSLA] Error processing tenant');
      }
    }

    logger.info('[TicketSLA] Done.');
  },
  {
    connection: bullmqConnection,
    concurrency: 1,
    lockDuration: 120_000,
  },
);

ticketSlaWorker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id }, '[TicketSLA] Job failed');
});

void ticketSlaQueue.add(
  'check-ticket-sla',
  {},
  {
    jobId: TICKET_SLA_JOB_ID,
    repeat: { every: TICKET_SLA_EVERY_MS },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
).catch((err) => {
  logger.error({ err }, '[TicketSLA] Failed to schedule job');
});
