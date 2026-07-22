import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { bullmqConnection } from '../config/redis.js';
import { sendEmail } from '../services/email.service.js';
import { buildTenantUrl } from '../utils/url.js';
import { renderTicketSlaWarning } from '../modules/tickets/emails/ticket-sla-warning.email.js';

type Lang = 'pt-BR' | 'en-US' | 'es';

interface TicketSlaWarningJobData {}

export interface TenantRow {
  id: string;
  schemaName: string;
  name: string;
  slug: string;
  settings: unknown;
}

interface WarningTicketRow {
  id: string;
  ticket_number: number;
  title: string;
  due_date: Date;
  assignee_email: string | null;
  creator_email: string | null;
}

const QUEUE_NAME = 'ziradesk-ticket-sla-warning';
const TICKET_SLA_WARNING_JOB_ID = 'ticket-sla-warning-every-15-min';
const TICKET_SLA_WARNING_EVERY_MS = 15 * 60 * 1000;
const SLA_WARNING_WINDOW_MS = 30 * 60 * 1000;

export const ticketSlaWarningQueue = new Queue<TicketSlaWarningJobData>(QUEUE_NAME, {
  connection: bullmqConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
});

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Réplica local de tenantLanguage (lib/lgpd/sla.service.ts) — não exportada de lá,
// e é pequena o suficiente para não justificar acoplar o domínio de tickets ao de LGPD.
function tenantLanguage(tenant: TenantRow): Lang {
  const settings = (tenant.settings as Record<string, unknown>) ?? {};
  const lang = settings['language'];
  if (lang === 'en-US' || lang === 'es') return lang;
  return 'pt-BR';
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

// Exportada (diferente de processTicketSlaForTenant em ticket-sla.job.ts, que é local)
// para permitir teste direto sem depender do BullMQ — espelha o padrão testável de
// processTenantSla em lib/lgpd/sla.service.ts, usado por lgpd-sla.integration.test.ts.
export async function processTicketSlaWarningForTenant(tenant: TenantRow): Promise<void> {
  const schema = quoteIdent(tenant.schemaName);
  const lang = tenantLanguage(tenant);
  const hasCreatedBy = await hasColumn(tenant.schemaName, 'tickets', 'created_by');
  const createdBySelect = hasCreatedBy
    ? 'uc.email AS creator_email'
    : 'NULL::text AS creator_email';
  const creatorJoin = hasCreatedBy
    ? `LEFT JOIN ${schema}.users uc ON uc.id = t.created_by`
    : '';

  const tickets = await prisma.$queryRawUnsafe<WarningTicketRow[]>(
    `SELECT
       t.id,
       t.ticket_number,
       t.title,
       t.due_date,
       ua.email AS assignee_email,
       ${createdBySelect}
     FROM ${schema}.tickets t
     LEFT JOIN ${schema}.users ua ON ua.id = t.assigned_to
     ${creatorJoin}
     WHERE t.status NOT IN ('resolved', 'closed', 'canceled')
       AND t.due_date IS NOT NULL
       AND t.sla_paused_at IS NULL
       AND t.sla_warning_sent_at IS NULL
       AND (t.due_date + (t.sla_paused_duration_seconds || ' seconds')::interval)
             BETWEEN NOW() AND NOW() + (${SLA_WARNING_WINDOW_MS / 60_000} * INTERVAL '1 minute')`,
  );

  if (tickets.length === 0) return;

  logger.info({ tenantId: tenant.id, count: tickets.length }, '[TicketSLAWarning] Tickets approaching SLA breach');

  for (const ticket of tickets) {
    try {
      const recipients: string[] = [];
      if (ticket.assignee_email) recipients.push(ticket.assignee_email);
      if (ticket.creator_email && ticket.creator_email !== ticket.assignee_email) {
        recipients.push(ticket.creator_email);
      }

      if (recipients.length === 0) continue;

      const ticketNum = `#${String(ticket.ticket_number).padStart(5, '0')}`;
      const minutesUntilBreach = Math.max(0, Math.round((ticket.due_date.getTime() - Date.now()) / 60_000));
      const ticketUrl = buildTenantUrl(tenant.slug, `/tickets/${ticket.id}`);

      const email = renderTicketSlaWarning({
        ticketNumber: ticketNum,
        ticketTitle: ticket.title,
        minutesUntilBreach,
        ticketUrl,
        lang,
      });

      await sendEmail({
        tenantId: tenant.id,
        tenantSchema: tenant.schemaName,
        to: recipients,
        subject: email.subject,
        html: email.html,
        text: email.text,
        from: { name: tenant.name },
      });

      await prisma.$executeRawUnsafe(
        `UPDATE ${schema}.tickets SET sla_warning_sent_at = NOW() WHERE id = $1::uuid`,
        ticket.id,
      );

      logger.info({ tenantId: tenant.id, ticketId: ticket.id, ticketNum }, '[TicketSLAWarning] Warning sent');
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, '[TicketSLAWarning] Error sending warning');
    }
  }
}

export const ticketSlaWarningWorker = new Worker<TicketSlaWarningJobData>(
  QUEUE_NAME,
  async () => {
    logger.info('[TicketSLAWarning] Checking tickets approaching SLA breach...');

    const tenants = await prisma.tenant.findMany({
      where: { status: { in: ['active', 'trial'] } },
      select: { id: true, schemaName: true, name: true, slug: true, settings: true },
    });

    for (const tenant of tenants) {
      try {
        await processTicketSlaWarningForTenant(tenant);
      } catch (err) {
        logger.error({ err, tenantId: tenant.id }, '[TicketSLAWarning] Error processing tenant');
      }
    }

    logger.info('[TicketSLAWarning] Done.');
  },
  {
    connection: bullmqConnection,
    concurrency: 1,
    lockDuration: 120_000,
  },
);

ticketSlaWarningWorker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id }, '[TicketSLAWarning] Job failed');
});

void ticketSlaWarningQueue.add(
  'check-ticket-sla-warning',
  {},
  {
    jobId: TICKET_SLA_WARNING_JOB_ID,
    repeat: { every: TICKET_SLA_WARNING_EVERY_MS },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
).catch((err) => {
  logger.error({ err }, '[TicketSLAWarning] Failed to schedule job');
});
