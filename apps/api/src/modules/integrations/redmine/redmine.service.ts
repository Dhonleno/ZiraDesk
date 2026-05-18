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

const PRIORITY_MAP_DEFAULT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

const priorityCache = new Map<string, Record<string, number>>();

interface RedmineIntegrationRow {
  id: string;
  redmine_url: string;
  api_key: string;
  project_id: string;
  is_active: boolean;
  sync_comments: boolean;
  sync_status: boolean;
  sync_company: boolean;
  status_map: unknown;
  priority_map: unknown;
}

interface TicketMapRow {
  redmine_issue_id: number;
  redmine_company_id?: number | null;
}

interface TicketRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
}

interface OrganizationRow {
  id: string;
  name: string;
  document: string | null;
}

interface RedmineCompany {
  id: number;
  name: string;
}

interface RedmineCompanyResponse {
  company?: {
    id?: number;
    name?: string;
  };
}

interface RedmineIssueResponse {
  issue?: {
    id?: number;
    company?: {
      id?: number;
      name?: string;
    };
    company_id?: number;
  };
}

type RawExecutor = typeof prisma;

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function ensureSafeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/i.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }
  return schemaName.replace(/"/g, '""');
}

async function withTenantSchema<T>(
  schemaName: string,
  runner: (db: RawExecutor) => Promise<T>,
): Promise<T> {
  const safeSchemaName = ensureSafeSchemaName(schemaName);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);
    return runner(tx as RawExecutor);
  });
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

function parsePriorityMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(num) && num > 0) parsed[key] = num;
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
      sync_company    BOOLEAN DEFAULT true,
      status_map      JSONB DEFAULT '{}'::jsonb,
      priority_map    JSONB DEFAULT '{}'::jsonb,
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
      redmine_company_id INTEGER,
      integration_id   UUID REFERENCES ${schema}.redmine_integrations(id),
      last_synced_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticket_id, integration_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.redmine_integrations
    ADD COLUMN IF NOT EXISTS sync_company BOOLEAN DEFAULT true
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.redmine_integrations
    ADD COLUMN IF NOT EXISTS priority_map JSONB DEFAULT '{}'::jsonb
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.redmine_ticket_map
    ADD COLUMN IF NOT EXISTS redmine_company_id INTEGER
  `);
}

async function getActiveIntegration(schemaName: string): Promise<RedmineIntegrationRow | null> {
  await ensureRedmineInfrastructure(schemaName);
  const schema = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<RedmineIntegrationRow[]>(`
    SELECT id, redmine_url, api_key, project_id, is_active, sync_comments, sync_status, sync_company, status_map, priority_map
    FROM ${schema}.redmine_integrations
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function fetchPriorityMap(
  schemaName: string,
  integration: RedmineIntegrationRow,
  apiKey: string,
): Promise<Record<string, number>> {
  if (priorityCache.has(integration.id)) {
    return priorityCache.get(integration.id)!;
  }

  const cachedFromDb = parsePriorityMap(integration.priority_map);
  if (Object.keys(cachedFromDb).length > 0) {
    priorityCache.set(integration.id, cachedFromDb);
    return cachedFromDb;
  }

  const response = await fetch(
    `${normalizeRedmineUrl(integration.redmine_url)}/enumerations/issue_priorities.json`,
    {
      headers: { 'X-Redmine-API-Key': apiKey },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    logger.warn(
      { integrationId: integration.id, status: response.status },
      '[Redmine] Failed to load priorities; using fallback map',
    );
    return PRIORITY_MAP_DEFAULT;
  }

  const data = (await response.json()) as {
    issue_priorities?: Array<{ id: number; name: string; is_default?: boolean }>;
  };

  const priorities = data.issue_priorities ?? [];
  const map: Record<string, number> = {};

  if (priorities[0]) map.low = priorities[0].id;
  if (priorities[1]) map.medium = priorities[1].id;
  if (priorities[2]) map.high = priorities[2].id;
  if (priorities[3]) map.urgent = priorities[3].id;

  const defaultPriority = priorities.find((priority) => priority.is_default);
  if (defaultPriority) map.medium = defaultPriority.id;

  if (Object.keys(map).length === 0) {
    logger.warn(
      { integrationId: integration.id },
      '[Redmine] Empty priorities payload; using fallback map',
    );
    return PRIORITY_MAP_DEFAULT;
  }

  priorityCache.set(integration.id, map);

  const schema = quoteIdent(schemaName);
  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_integrations
     SET priority_map = $1::jsonb, updated_at = NOW()
     WHERE id = $2::uuid`,
    JSON.stringify(map),
    integration.id,
  );

  logger.info({ integrationId: integration.id, map }, '[Redmine] Priority map loaded');
  return map;
}

function normalizeRedmineUrl(redmineUrl: string): string {
  return redmineUrl.replace(/\/+$/, '');
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function isFuzzyNameMatch(left: string, right: string): boolean {
  const leftNorm = normalizeName(left);
  const rightNorm = normalizeName(right);
  if (!leftNorm || !rightNorm) return false;
  return leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm);
}

async function fetchRedmineCompanies(
  redmineUrl: string,
  apiKey: string,
  projectId?: string,
  search?: string,
): Promise<RedmineCompany[]> {
  const baseUrl = normalizeRedmineUrl(redmineUrl);
  const query = search
    ? `key=${encodeURIComponent(apiKey)}&search=${encodeURIComponent(search)}&limit=10`
    : `key=${encodeURIComponent(apiKey)}&limit=25`;

  const urls = projectId?.trim()
    ? [
        `${baseUrl}/projects/${encodeURIComponent(projectId)}/companies.json?${query}`,
        `${baseUrl}/companies.json?${query}`,
      ]
    : [`${baseUrl}/companies.json?${query}`];

  for (const url of urls) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) continue;
    const data = (await response.json()) as { companies?: RedmineCompany[] };
    return data.companies ?? [];
  }

  return [];
}

async function createRedmineCompany(
  redmineUrl: string,
  apiKey: string,
  projectId: string,
  orgName: string,
): Promise<RedmineCompany | null> {
  const baseUrl = normalizeRedmineUrl(redmineUrl);

  const endpoints = [
    {
      url: `${baseUrl}/projects/${encodeURIComponent(projectId)}/companies.json`,
      body: { company: { name: orgName } },
    },
    {
      url: `${baseUrl}/companies.json`,
      body: { company: { name: orgName } },
    },
  ];

  for (const endpoint of endpoints) {
    const createResp = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Redmine-API-Key': apiKey,
      },
      body: JSON.stringify(endpoint.body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!createResp.ok) {
      const details = await createResp.text().catch(() => '');
      logger.warn(
        { orgName, status: createResp.status, url: endpoint.url, details: details.slice(0, 500) },
        '[Redmine] Company create attempt failed',
      );
      continue;
    }

    const created = (await createResp.json()) as RedmineCompanyResponse;
    const createdCompanyId = created.company?.id;
    if (!createdCompanyId) return null;

    const createdCompanyName = created.company?.name?.trim() || orgName;
    return { id: createdCompanyId, name: createdCompanyName };
  }

  return null;
}

async function fetchRedmineCompanyById(
  redmineUrl: string,
  apiKey: string,
  companyId: number,
): Promise<RedmineCompany | null> {
  const baseUrl = normalizeRedmineUrl(redmineUrl);
  const response = await fetch(
    `${baseUrl}/companies/${companyId}.json?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as RedmineCompanyResponse;
  if (!data.company?.id || !data.company?.name) return null;
  return { id: data.company.id, name: data.company.name };
}

async function fetchRedmineIssueCompany(
  redmineUrl: string,
  apiKey: string,
  issueId: number,
): Promise<RedmineCompany | null> {
  const baseUrl = normalizeRedmineUrl(redmineUrl);
  const response = await fetch(
    `${baseUrl}/issues/${issueId}.json?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as RedmineIssueResponse;
  const companyId = data.issue?.company?.id ?? data.issue?.company_id;
  const companyName = data.issue?.company?.name;
  if (!companyId) return null;
  if (companyName?.trim()) return { id: companyId, name: companyName.trim() };
  return fetchRedmineCompanyById(redmineUrl, apiKey, companyId);
}

async function loadTicketOrganization(
  schemaName: string,
  ticketId: string,
): Promise<OrganizationRow | null> {
  return withTenantSchema(schemaName, async (db) => {
    const rows = await db.$queryRawUnsafe<OrganizationRow[]>(
      `SELECT o.id, o.name, o.document
       FROM tickets t
       JOIN organizations o ON o.id = t.organization_id
       WHERE t.id = $1::uuid
       LIMIT 1`,
      ticketId,
    );
    return rows[0] ?? null;
  });
}

async function findOrganizationByCompanyName(
  schemaName: string,
  companyName: string,
): Promise<{ id: string; name: string } | null> {
  return withTenantSchema(schemaName, async (db) => {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; name: string }>>(
      `SELECT o.id, o.name
       FROM organizations o
       WHERE LOWER(o.name) = LOWER($1)
          OR LOWER(o.name) LIKE '%' || LOWER($1) || '%'
          OR LOWER($1) LIKE '%' || LOWER(o.name) || '%'
       ORDER BY
         CASE WHEN LOWER(o.name) = LOWER($1) THEN 0 ELSE 1 END,
         LENGTH(o.name) ASC
       LIMIT 1`,
      companyName,
    );
    return rows[0] ?? null;
  });
}

async function resolveCompanyForTicket(
  schemaName: string,
  integration: RedmineIntegrationRow,
  apiKey: string,
  ticketId: string,
): Promise<RedmineCompany | null> {
  if (!integration.sync_company) return null;

  const organization = await loadTicketOrganization(schemaName, ticketId);
  const orgName = organization?.name?.trim();
  if (!orgName) return null;

  const companies = await fetchRedmineCompanies(
    integration.redmine_url,
    apiKey,
    integration.project_id,
    orgName,
  ).catch(() => []);
  const exactMatch = companies.find((company) => isFuzzyNameMatch(company.name, orgName));
  if (exactMatch) {
    logger.info(
      { ticketId, companyId: exactMatch.id, companyName: exactMatch.name },
      '[Redmine] Company matched',
    );
    return exactMatch;
  }

  const createdCompany = await createRedmineCompany(
    integration.redmine_url,
    apiKey,
    integration.project_id,
    orgName,
  );
  if (!createdCompany) {
    logger.warn({ ticketId, orgName }, '[Redmine] Failed to create company');
    return null;
  }

  logger.info(
    { ticketId, companyId: createdCompany.id, orgName },
    '[Redmine] Company created',
  );
  return createdCompany;
}

async function linkCompanyToIssue(
  redmineUrl: string,
  apiKey: string,
  issueId: number,
  companyId: number,
): Promise<boolean> {
  const baseUrl = normalizeRedmineUrl(redmineUrl);

  try {
    const directResp = await fetch(`${baseUrl}/issues/${issueId}.json`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Redmine-API-Key': apiKey,
      },
      body: JSON.stringify({
        issue: { company_id: companyId },
      }),
      signal: AbortSignal.timeout(5_000),
    });

    logger.info(
      { issueId, companyId, url: `${baseUrl}/issues/${issueId}.json`, status: directResp.status },
      '[Redmine] Company link attempt',
    );

    if (directResp.ok) {
      const resolvedCompany = await fetchRedmineIssueCompany(redmineUrl, apiKey, issueId).catch(() => null);
      if (resolvedCompany?.id === companyId) {
        logger.info(
          { issueId, companyId },
          '[Redmine] Company linked successfully',
        );
        return true;
      }
    }
  } catch (err) {
    logger.warn(
      { issueId, companyId, url: `${baseUrl}/issues/${issueId}.json`, status: null, err },
      '[Redmine] Company link attempt failed',
    );
  }

  const endpoints: Array<{ url: string; body: Record<string, unknown> }> = [
    {
      url: `${baseUrl}/issues/${issueId}/contacts.json`,
      body: { contact_id: companyId },
    },
    {
      url: `${baseUrl}/issues/${issueId}/company.json`,
      body: { company_id: companyId },
    },
    {
      url: `${baseUrl}/contacts/${companyId}/issues.json`,
      body: { issue_id: issueId },
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Redmine-API-Key': apiKey,
        },
        body: JSON.stringify(endpoint.body),
        signal: AbortSignal.timeout(5_000),
      });

      logger.info(
        { issueId, companyId, url: endpoint.url, status: resp.status },
        '[Redmine] Company link attempt',
      );

      if (resp.ok || resp.status === 201) {
        logger.info(
          { issueId, companyId, url: endpoint.url },
          '[Redmine] Company linked successfully',
        );
        return true;
      }
    } catch (err) {
      logger.warn(
        { issueId, companyId, url: endpoint.url, status: null, err },
        '[Redmine] Company link attempt failed',
      );
    }
  }

  const customFieldAttempts = [
    { id: 45, value: String(companyId) },
    { id: 46, value: String(companyId) },
    { id: 47, value: String(companyId) },
  ];

  for (const customField of customFieldAttempts) {
    try {
      const resp = await fetch(`${baseUrl}/issues/${issueId}.json`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Redmine-API-Key': apiKey,
        },
        body: JSON.stringify({
          issue: { custom_fields: [{ id: customField.id, value: customField.value }] },
        }),
        signal: AbortSignal.timeout(5_000),
      });

      logger.info(
        { issueId, companyId, customFieldId: customField.id, status: resp.status },
        '[Redmine] Company link attempt',
      );

      if (!resp.ok) continue;

      const checkResp = await fetch(
        `${baseUrl}/issues/${issueId}.json?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!checkResp.ok) continue;

      const data = (await checkResp.json()) as {
        issue?: { custom_fields?: Array<{ id: number; value: string }> };
      };
      const field = data.issue?.custom_fields?.find((item) => item.id === customField.id);
      if (field?.value === String(companyId)) {
        logger.info(
          { issueId, companyId, customFieldId: customField.id },
          '[Redmine] Company linked via custom_field',
        );
        return true;
      }
    } catch (err) {
      logger.warn(
        { issueId, companyId, customFieldId: customField.id, status: null, err },
        '[Redmine] Company link attempt failed',
      );
    }
  }

  logger.warn(
    { issueId, companyId },
    '[Redmine] Could not link company — all attempts failed',
  );
  return false;
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
    `SELECT redmine_issue_id, redmine_company_id
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

  const priorityMap = await fetchPriorityMap(schemaName, integration, apiKey).catch((err) => {
    logger.warn({ integrationId: integration.id, err }, '[Redmine] Priority map fetch failed');
    return PRIORITY_MAP_DEFAULT;
  });
  const redminePriorityId = priorityMap[ticket.priority] ?? priorityMap.medium ?? 2;

  const issuePayload: {
    issue: {
      project_id: string;
      subject: string;
      description: string;
      status_id: number;
      priority_id: number;
      company_id?: number;
    };
  } = {
    issue: {
      project_id: integration.project_id,
      subject: ticket.title,
      description: ticket.description ?? '',
      status_id: redmineStatusId,
      priority_id: redminePriorityId,
    },
  };

  const resolvedCompany = await resolveCompanyForTicket(schemaName, integration, apiKey, ticketId).catch((err) => {
    logger.warn({ ticketId, err }, '[Redmine] Company sync skipped');
    return null;
  });

  const redmineCompanyId = resolvedCompany?.id ?? null;
  if (redmineCompanyId) {
    issuePayload.issue.company_id = redmineCompanyId;
  }

  if (event === 'created' && !existingMap) {
    let response = await fetch(`${normalizeRedmineUrl(integration.redmine_url)}/issues.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Redmine-API-Key': apiKey,
      },
      body: JSON.stringify(issuePayload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok && response.status === 422 && issuePayload.issue.priority_id) {
      const fallbackPayload = {
        issue: {
          project_id: issuePayload.issue.project_id,
          subject: issuePayload.issue.subject,
          description: issuePayload.issue.description,
          status_id: issuePayload.issue.status_id,
          ...(issuePayload.issue.company_id ? { company_id: issuePayload.issue.company_id } : {}),
        },
      };
      response = await fetch(`${normalizeRedmineUrl(integration.redmine_url)}/issues.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Redmine-API-Key': apiKey,
        },
        body: JSON.stringify(fallbackPayload),
        signal: AbortSignal.timeout(10_000),
      });
    }

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      logger.error(
        { ticketId, status: response.status, details: details.slice(0, 500) },
        '[Redmine] Failed to create issue',
      );
      return;
    }

    const result = (await response.json()) as RedmineIssueResponse;
    const redmineIssueId = result.issue?.id;
    if (!redmineIssueId) return;

    const persistedCompanyId = result.issue?.company?.id ?? result.issue?.company_id ?? null;
    const shouldTryAsyncCompanyLink =
      Boolean(redmineCompanyId) &&
      persistedCompanyId !== redmineCompanyId;

    if (shouldTryAsyncCompanyLink && event === 'created' && redmineCompanyId) {
      void linkCompanyToIssue(
        integration.redmine_url,
        apiKey,
        redmineIssueId,
        redmineCompanyId,
      ).catch((err) => {
        logger.warn({ ticketId, redmineIssueId, redmineCompanyId, err }, '[Redmine] Company link async failed');
      });
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${schema}.redmine_ticket_map (ticket_id, redmine_issue_id, integration_id, redmine_company_id)
       VALUES ($1::uuid, $2::integer, $3::uuid, $4::integer)
       ON CONFLICT (ticket_id, integration_id)
       DO UPDATE SET
         redmine_issue_id = EXCLUDED.redmine_issue_id,
         redmine_company_id = EXCLUDED.redmine_company_id,
         last_synced_at = NOW()`,
      ticketId,
      redmineIssueId,
      integration.id,
      redmineCompanyId,
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

  let response = await fetch(`${normalizeRedmineUrl(integration.redmine_url)}/issues/${existingMap.redmine_issue_id}.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Redmine-API-Key': apiKey,
    },
    body: JSON.stringify(issuePayload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok && response.status === 422 && issuePayload.issue.priority_id) {
    const fallbackPayload = {
      issue: {
        project_id: issuePayload.issue.project_id,
        subject: issuePayload.issue.subject,
        description: issuePayload.issue.description,
        status_id: issuePayload.issue.status_id,
        ...(issuePayload.issue.company_id ? { company_id: issuePayload.issue.company_id } : {}),
      },
    };
    response = await fetch(`${normalizeRedmineUrl(integration.redmine_url)}/issues/${existingMap.redmine_issue_id}.json`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Redmine-API-Key': apiKey,
      },
      body: JSON.stringify(fallbackPayload),
      signal: AbortSignal.timeout(10_000),
    });
  }

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    logger.error(
      {
        ticketId,
        redmineIssueId: existingMap.redmine_issue_id,
        status: response.status,
        details: details.slice(0, 500),
      },
      '[Redmine] Failed to update issue',
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_ticket_map
     SET
       redmine_company_id = COALESCE($3::integer, redmine_company_id),
       last_synced_at = NOW()
     WHERE ticket_id = $1::uuid
       AND integration_id = $2::uuid`,
    ticketId,
    integration.id,
    redmineCompanyId,
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
    `${normalizeRedmineUrl(integration.redmine_url)}/issues/${maps[0].redmine_issue_id}.json`,
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
    company?: { id?: number; name?: string };
    company_id?: number;
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
  const credentials = decryptCredentials(integration.api_key);
  const apiKey = credentials['api_key'] ?? '';

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

  let webhookCompanyId = payload.issue?.company?.id ?? payload.issue?.company_id ?? null;
  let webhookCompanyName = payload.issue?.company?.name?.trim() ?? null;

  if (integration.sync_company) {
    if (webhookCompanyId && !webhookCompanyName && apiKey) {
      const fetchedCompany = await fetchRedmineCompanyById(
        integration.redmine_url,
        apiKey,
        webhookCompanyId,
      ).catch(() => null);
      if (fetchedCompany?.name) webhookCompanyName = fetchedCompany.name;
    }

    if ((!webhookCompanyId || !webhookCompanyName) && apiKey) {
      const issueCompany = await fetchRedmineIssueCompany(
        integration.redmine_url,
        apiKey,
        issueId,
      ).catch(() => null);
      if (issueCompany?.id) webhookCompanyId = issueCompany.id;
      if (issueCompany?.name) webhookCompanyName = issueCompany.name;
    }

    if (webhookCompanyId && webhookCompanyName) {
      const matchedOrg = await findOrganizationByCompanyName(schemaName, webhookCompanyName);
      if (matchedOrg) {
        await prisma.$executeRawUnsafe(
          `UPDATE ${schema}.tickets
           SET organization_id = $1::uuid, updated_at = NOW()
           WHERE id = $2::uuid`,
          matchedOrg.id,
          ticketId,
        );
        logger.info(
          {
            ticketId,
            redmineCompanyId: webhookCompanyId,
            redmineCompanyName: webhookCompanyName,
            organizationId: matchedOrg.id,
            organizationName: matchedOrg.name,
          },
          '[Redmine] Company updated from webhook',
        );
      } else {
        logger.warn(
          { ticketId, redmineCompanyId: webhookCompanyId, redmineCompanyName: webhookCompanyName },
          '[Redmine] Company not mapped to organization',
        );
      }
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
     SET
       redmine_company_id = COALESCE($3::integer, redmine_company_id),
       last_synced_at = NOW()
     WHERE ticket_id = $1::uuid
       AND integration_id = $2::uuid`,
    ticketId,
    integration.id,
    webhookCompanyId,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE ${schema}.redmine_integrations
     SET last_sync_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid`,
    integration.id,
  );
}
