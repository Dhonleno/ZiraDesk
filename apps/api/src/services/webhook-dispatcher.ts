import { createHmac } from 'node:crypto';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

export interface WebhookPayload {
  event: string;
  timestamp: string;
  tenantId: string;
  data: Record<string, unknown>;
}

interface WebhookTarget {
  id: string;
  url: string;
  secret: string | null;
  headers: Record<string, string>;
}

interface FireResult {
  status: number;
}

export async function fireWebhook(webhook: WebhookTarget, body: string): Promise<FireResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ZiraDesk-Webhook/1.0',
    ...webhook.headers,
  };

  if (webhook.secret) {
    const signature = 'sha256=' + createHmac('sha256', webhook.secret).update(body).digest('hex');
    headers['X-ZiraDesk-Signature'] = signature;
  }

  let status = 0;

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    status = response.status;

    await prisma.$executeRawUnsafe(
      `UPDATE outbound_webhooks SET last_triggered_at = NOW(), last_status = $1 WHERE id = $2::uuid`,
      status,
      webhook.id,
    );

    if (!response.ok) {
      logger.warn({ webhookId: webhook.id, status }, '[Webhook] Delivery failed');
    } else {
      logger.info({ webhookId: webhook.id, status }, '[Webhook] Delivered');
    }
  } catch (err) {
    logger.error({ webhookId: webhook.id, err }, '[Webhook] Delivery error');

    await prisma.$executeRawUnsafe(
      `UPDATE outbound_webhooks SET last_triggered_at = NOW(), last_status = 0 WHERE id = $1::uuid`,
      webhook.id,
    ).catch(() => { /* best-effort */ });
  }

  return { status };
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function resolveSchemaName(tenantId: string): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  return tenant?.schemaName ?? null;
}

export async function dispatchWebhook(
  tenantId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  let schemaName: string | null;
  try {
    schemaName = await resolveSchemaName(tenantId);
  } catch {
    return;
  }

  if (!schemaName) return;

  const schema = quoteIdent(schemaName);

  let webhooks: WebhookTarget[] = [];
  try {
    webhooks = await prisma.$queryRawUnsafe<WebhookTarget[]>(
      `SELECT id, url, secret, headers
       FROM ${schema}.outbound_webhooks
       WHERE is_active = true AND $1 = ANY(events)`,
      event,
    );
  } catch {
    // Table may not exist yet for tenants that haven't configured webhooks
    return;
  }

  if (webhooks.length === 0) return;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    tenantId,
    data,
  };

  const body = JSON.stringify(payload);

  void Promise.allSettled(webhooks.map((webhook) => fireWebhook(webhook, body)));
}
