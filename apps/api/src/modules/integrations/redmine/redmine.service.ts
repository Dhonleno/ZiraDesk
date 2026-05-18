import { prisma } from '../../../config/database.js';
import { logger } from '../../../config/logger.js';
import { decryptCredentials } from '../../../utils/crypto.js';

const STATUS_MAP_DEFAULT: Record<string, number> = {
  open: 1, // New
  in_progress: 2, // In Progress
  waiting: 4, // Feedback
  resolved: 3, // Resolved
  closed: 5, // Closed
};

interface RedmineIntegrationRow {
  id: string;
  redmine_url: string;
  api_key: string;
  project_id: string;
  is_active: boolean;
  sync_comments: boolean;
  sync_status: boolean;
  status_map: unknown;
}

interface TicketMapRow {
  redmine_issue_id: number;
}

interface TicketRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function parseStatusMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(num)) parsed[key] = num;
  }
  return parsed;
}

async function ensureRedmineInfrastructure(schemaName: string): Promise<void> {
  const schema = quoteIdent(schemaName);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.redmine_integrations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(100) NOT NULL DEFAULT 'Redmine',
      redmine_url     VARCHAR(500) NOT NULL,
      api_key         VARCHAR(255) NOT NULL,
      project_id      VARCHAR(100) NOT NULL,
      is_active       BOOLEAN DEFAULT true,
      sync_comments   BOOLEAN DEFAULT true,
      sync_status     BOOLEAN DEFAULT true,
      status_map      JSONB DEFAULT '{}'::jsonb,
      last_sync_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.redmine_ticket_map (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id        UUID NOT NULL,
      redmine_issue_id INTEGER NOT NULL,
      integration_id   UUID REFERENCES ${schema}.redmine_integrations(id),
      last_synced_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticket_id, integration_id)
    )
  `);
}

async function getActiveIntegration(schemaName: string): Promise<RedmineIntegrationRow | null> {
  await ensureRedmineInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<RedmineIntegrationRow[]>(`
    SELECT id, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, status_map
    FROM ${schema}.redmine_integrations
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

// ─── ZiraDesk → Redmine ───────────────────────────────
export async function syncTicketToRedmine(
  _tenantId: string,
  schemaName: string,
  ticketId: string,
  event: 'created' | 'updated' | 'resolved' | 'closed',
): Promise<void> {
  void _tenantId;
  const integration = await getActiveIntegration(schemaName);
  if (!integration) return;

  const credentials = decryptCredentials(integration.api_key);
  const apiKey = credentials['api_key'];
  if (!apiKey) return;

  const schema = quoteIdent(schemaName);
  const tickets = await prisma.$queryRawUnsafe<TicketRow[]>(
    `SELECT id, title, description, status, priority
     FROM ${schema}.tickets
     WHERE id = $1::uuid
     LIMIT 1`,
    ticketId,
  );
  const ticket = tickets[0];
  if (!ticket) return;

  const maps = await prisma.$queryRawUnsafe<TicketMapRow[]>(
    `SELECT redmine_issue_id
     FROM ${schema}.redmine_ticket_map
     WHERE ticket_id = $1::uuid
       AND integration_id = $2::uuid
     LIMIT 1`,
    ticketId,
    integration.id,
  );
  const existingMap = maps[0];

  const statusMap = { ...STATUS_MAP_DEFAULT, ...parseStatusMap(integration.status_map) };
  const redmineStatusId = statusMap[ticket.status] ?? 1;

  const priorityMap: Record<string, number> = {
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4,
  };

  const issuePayload = {
    issue: {
      project_id: integration.project_id,
      subject: ticket.title,
      description: ticket.description ?? '',
      status_id: redmineStatusId,
      priority_id: priorityMap[ticket.priority] ?? 2,
    },
  };

  if (event === 'created' && !existingMap) {
    const response = await fetch(`${integration.redmine_url}/issues.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Redmine-API-Key': apiKey,
      },
      body: JSON.stringify(issuePayload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error({ ticketId, status: response.status }, '[Redmine] Failed to create issue');
      return;
    }

    const result = (await response.json()) as { issue?: { id?: number } };
    const redmineIssueId = result.issue?.id;
    if (!redmineIssueId) return;

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${schema}.redmine_ticket_map (ticket_id, redmine_issue_id, integration_id)
       VALUES ($1::uuid, $2::integer, $3::uuid)
       ON CONFLICT (ticket_id, integration_id)
       DO UPDATE SET redmine_issue_id = EXCLUDED.redmine_issue_id, last_synced_at = NOW()`,
      ticketId,
      redmineIssueId,
      integration.id,
    );

    await prisma.$executeRawUnsafe(
      `UPDATE ${schema}.redmine_integrations
       SET last_sync_at = NOW(), updated_at = NOW()
       WHERE id = $1::uuid`,
      integration.id,
    );

    logger.info({ ticketId, redmineIssueId }, '[Redmine] Issue created');
    return;
  }

  if (!existingMap) return;

  const response = await fetch(`${integration.redmine_url}/issues/${existingMap.redmine_issue_id}.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Redmine-API-Key': apiKey,
    },
    body: JSON.stringify(issuePayload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    logger.error(
      { ticketId, redmineIssueId: existingMap.redmine_issue_id, status: response.status },
      '[Redmine] Failed to update issue',
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_ticket_map
     SET last_synced_at = NOW()
     WHERE ticket_id = $1::uuid
       AND integration_id = $2::uuid`,
    ticketId,
    integration.id,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_integrations
     SET last_sync_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid`,
    integration.id,
  );

  logger.info({ ticketId, redmineIssueId: existingMap.redmine_issue_id }, '[Redmine] Issue updated');
}

export async function syncCommentToRedmine(
  _tenantId: string,
  schemaName: string,
  ticketId: string,
  comment: { content: string; authorName: string; isInternal: boolean },
): Promise<void> {
  void _tenantId;
  if (comment.isInternal) return;

  const integration = await getActiveIntegration(schemaName);
  if (!integration || !integration.sync_comments) return;

  const credentials = decryptCredentials(integration.api_key);
  const apiKey = credentials['api_key'];
  if (!apiKey) return;

  const schema = quoteIdent(schemaName);
  const maps = await prisma.$queryRawUnsafe<TicketMapRow[]>(
    `SELECT redmine_issue_id
     FROM ${schema}.redmine_ticket_map
     WHERE ticket_id = $1::uuid
       AND integration_id = $2::uuid
     LIMIT 1`,
    ticketId,
    integration.id,
  );
  if (!maps[0]) return;

  const response = await fetch(
    `${integration.redmine_url}/issues/${maps[0].redmine_issue_id}.json`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Redmine-API-Key': apiKey,
      },
      body: JSON.stringify({
        issue: {
          notes: `**${comment.authorName}:** ${comment.content}`,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    logger.error({ ticketId, status: response.status }, '[Redmine] Failed to sync comment');
    return;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_ticket_map
     SET last_synced_at = NOW()
     WHERE ticket_id = $1::uuid
       AND integration_id = $2::uuid`,
    ticketId,
    integration.id,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_integrations
     SET last_sync_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid`,
    integration.id,
  );

  logger.info({ ticketId }, '[Redmine] Comment synced');
}

// ─── Redmine → ZiraDesk ───────────────────────────────
export interface RedmineWebhookPayload {
  action?: string;
  issue?: {
    id?: number;
    status?: { id?: number; name?: string };
    subject?: string;
  };
  journal?: {
    notes?: string;
    author?: { name?: string };
  };
}

export async function handleRedmineWebhook(
  _tenantId: string,
  schemaName: string,
  payload: RedmineWebhookPayload,
): Promise<void> {
  void _tenantId;
  const issueId = payload.issue?.id;
  if (!issueId) return;

  const integration = await getActiveIntegration(schemaName);
  if (!integration) return;

  const schema = quoteIdent(schemaName);
  const maps = await prisma.$queryRawUnsafe<Array<{ ticket_id: string }>>(
    `SELECT tm.ticket_id
     FROM ${schema}.redmine_ticket_map tm
     JOIN ${schema}.redmine_integrations ri ON ri.id = tm.integration_id
     WHERE tm.redmine_issue_id = $1::integer
       AND tm.integration_id = $2::uuid
       AND ri.is_active = true
     LIMIT 1`,
    issueId,
    integration.id,
  );
  if (!maps[0]) return;

  const ticketId = maps[0].ticket_id;
  const statusMap = { ...STATUS_MAP_DEFAULT, ...parseStatusMap(integration.status_map) };
  const reverseStatusMap: Record<number, string> = {};
  for (const [zrStatus, rmStatus] of Object.entries(statusMap)) {
    reverseStatusMap[rmStatus] = zrStatus;
  }

  const issueSubject = payload.issue?.subject?.trim();
  if (issueSubject) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${schema}.tickets
       SET title = $1, updated_at = NOW()
       WHERE id = $2::uuid`,
      issueSubject,
      ticketId,
    );
  }

  const redmineStatusId = payload.issue?.status?.id;
  if (integration.sync_status && redmineStatusId) {
    const newStatus = reverseStatusMap[redmineStatusId];
    if (newStatus) {
      await prisma.$executeRawUnsafe(
        `UPDATE ${schema}.tickets
         SET status = $1, updated_at = NOW()
         WHERE id = $2::uuid`,
        newStatus,
        ticketId,
      );
      logger.info({ ticketId, newStatus }, '[Redmine] Status synced from Redmine');
    }
  }

  const journalNotes = payload.journal?.notes?.trim();
  if (integration.sync_comments && journalNotes) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${schema}.ticket_comments (ticket_id, content, is_internal, source, created_at)
       VALUES ($1::uuid, $2, false, 'external', NOW())`,
      ticketId,
      `[Redmine] ${journalNotes}`,
    );
    logger.info({ ticketId }, '[Redmine] Comment synced from Redmine');
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_ticket_map
     SET last_synced_at = NOW()
     WHERE ticket_id = $1::uuid
       AND integration_id = $2::uuid`,
    ticketId,
    integration.id,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_integrations
     SET last_sync_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid`,
    integration.id,
  );
}
