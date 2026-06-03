import { prisma } from '../../../config/database.js';
import { messageQueue } from '../../../jobs/queue.js';
import { decryptCredentials } from '../../../utils/crypto.js';
import { logger } from '../../../config/logger.js';
import { quoteIdent } from '../conversations/protocols.js';

interface QueueSettings {
  queue_notifications_enabled: boolean;
  queue_message_template: string;
  queue_throttle_seconds: number;
  agent_assume_template: string;
  expire_24h_action: 'close' | 'keep_open';
  expire_24h_message: string;
}

interface ConvQueueRow {
  id: string;
  channel_type: string;
  contact_phone: string | null;
  channel_credentials: string | object | null;
  queue_entered_at: Date | null;
  assigned_to: string | null;
  status: string;
}

interface QueueNotifRow {
  id: string;
  conversation_id: string;
  last_position: number;
  last_notified_at: Date;
}

const DEFAULT_QUEUE_MESSAGE_TEMPLATE =
  'Você é o nº {{position}} na fila. Aguarde, em breve um agente irá atendê-lo.';
const DEFAULT_AGENT_ASSUME_TEMPLATE =
  'Olá! Meu nome é {{agent_name}}, vou continuar seu atendimento. Em que posso ajudar?';
const DEFAULT_EXPIRE_24H_MESSAGE =
  'Olá, infelizmente não conseguimos atender no momento. Por favor, entre em contato novamente quando puder.';

function parseQueueSettings(settings: unknown): QueueSettings {
  const s = typeof settings === 'object' && settings !== null
    ? (settings as Record<string, unknown>)
    : {};
  return {
    queue_notifications_enabled: s['queue_notifications_enabled'] !== false,
    queue_message_template:
      typeof s['queue_message_template'] === 'string' && s['queue_message_template'].trim()
        ? s['queue_message_template']
        : DEFAULT_QUEUE_MESSAGE_TEMPLATE,
    queue_throttle_seconds:
      typeof s['queue_throttle_seconds'] === 'number' && s['queue_throttle_seconds'] >= 30
        ? Math.trunc(s['queue_throttle_seconds'])
        : 60,
    agent_assume_template:
      typeof s['agent_assume_template'] === 'string' && s['agent_assume_template'].trim()
        ? s['agent_assume_template']
        : DEFAULT_AGENT_ASSUME_TEMPLATE,
    expire_24h_action: s['expire_24h_action'] === 'keep_open' ? 'keep_open' : 'close',
    expire_24h_message:
      typeof s['expire_24h_message'] === 'string' && s['expire_24h_message'].trim()
        ? s['expire_24h_message']
        : DEFAULT_EXPIRE_24H_MESSAGE,
  };
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

function escapeWhatsAppMarkdown(text: string): string {
  return text.replace(/([*_~`])/g, '\\$1');
}

async function ensureQueueNotificationsTable(schemaName: string): Promise<void> {
  const convRef = `${quoteIdent(schemaName)}.conversations`;
  const notifRef = `${quoteIdent(schemaName)}.queue_notifications`;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${notifRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES ${convRef}(id) ON DELETE CASCADE,
      last_position INT NOT NULL,
      last_notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      message_id VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_queue_notif_conv
    ON ${notifRef}(conversation_id)
  `);
}

async function getTenantQueueSettings(tenantId: string): Promise<QueueSettings> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  return parseQueueSettings(tenant?.settings ?? {});
}

async function sendSystemWhatsAppMessage(
  schemaName: string,
  tenantId: string,
  conversationId: string,
  content: string,
): Promise<string | null> {
  const convRows = await prisma.$queryRawUnsafe<ConvQueueRow[]>(
    `SELECT c.id, c.channel_type, c.assigned_to, c.status, c.queue_entered_at,
            COALESCE(ct.whatsapp, ct.phone) AS contact_phone,
            ch.credentials AS channel_credentials
     FROM ${quoteIdent(schemaName)}.conversations c
     LEFT JOIN ${quoteIdent(schemaName)}.contacts ct ON ct.id = c.contact_id
     LEFT JOIN ${quoteIdent(schemaName)}.channels ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );

  const conv = convRows[0];
  if (!conv) return null;
  if (conv.channel_type !== 'whatsapp') return null;
  if (!conv.contact_phone) return null;
  if (!conv.channel_credentials) return null;

  const msgRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO ${quoteIdent(schemaName)}.messages
       (id, conversation_id, sender_type, content, content_type, is_internal, status, created_at)
     VALUES (gen_random_uuid(), $1::uuid, 'system', $2, 'text', false, 'pending', NOW())
     RETURNING id`,
    conversationId,
    content,
  );
  const messageId = msgRows[0]?.id;
  if (!messageId) return null;

  let creds: Record<string, string>;
  try {
    const rawCreds = conv.channel_credentials;
    const credsInput = typeof rawCreds === 'string'
      ? rawCreds
      : JSON.stringify(rawCreds);
    creds = decryptCredentials(credsInput);
  } catch {
    logger.warn({ conversationId }, '[QueueNotif] Failed to decrypt channel credentials');
    return null;
  }

  await messageQueue.add('send', {
    messageId,
    conversationId,
    tenantId,
    tenantSchema: schemaName,
    channelType: 'whatsapp',
    channelCredentials: creds,
    content,
    to: conv.contact_phone,
  });

  return messageId;
}

async function auditQueueNotification(
  schemaName: string,
  conversationId: string,
  action: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quoteIdent(schemaName)}.audit_logs
         (user_id, action, entity, entity_id, new_data, created_at)
       VALUES (NULL, $1, 'conversation', $2::uuid, $3::jsonb, NOW())`,
      action,
      conversationId,
      JSON.stringify(data),
    );
  } catch (err) {
    logger.warn({ err, conversationId, action }, '[QueueNotif] Failed to write audit log');
  }
}

export async function notifyQueuePosition(
  schemaName: string,
  tenantId: string,
  conversationId: string,
): Promise<void> {
  const settings = await getTenantQueueSettings(tenantId);
  if (!settings.queue_notifications_enabled) return;

  const convRows = await prisma.$queryRawUnsafe<ConvQueueRow[]>(
    `SELECT c.id, c.channel_type, c.assigned_to, c.status, c.queue_entered_at,
            COALESCE(ct.whatsapp, ct.phone) AS contact_phone,
            ch.credentials AS channel_credentials
     FROM ${quoteIdent(schemaName)}.conversations c
     LEFT JOIN ${quoteIdent(schemaName)}.contacts ct ON ct.id = c.contact_id
     LEFT JOIN ${quoteIdent(schemaName)}.channels ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  const conv = convRows[0];
  if (!conv) return;
  if (conv.channel_type !== 'whatsapp') return;
  if (conv.assigned_to !== null) return;
  if (conv.status !== 'open') return;
  if (!conv.queue_entered_at) return;

  // Calculate 1-based queue position
  const posRows = await prisma.$queryRawUnsafe<Array<{ position: bigint }>>(
    `SELECT (
       COUNT(*) FILTER (
         WHERE assigned_to IS NULL
           AND status = 'open'
           AND COALESCE(metadata->>'bot_stage', '') <> 'waiting_choice'
           AND COALESCE(metadata->>'ai_agent_active', 'false') <> 'true'
           AND queue_entered_at < (
             SELECT queue_entered_at FROM ${quoteIdent(schemaName)}.conversations WHERE id = $1::uuid
           )
       ) + 1
     )::bigint AS position
     FROM ${quoteIdent(schemaName)}.conversations`,
    conversationId,
  );
  const position = Number(posRows[0]?.position ?? 1);

  await ensureQueueNotificationsTable(schemaName);

  // Check throttle
  const existingRows = await prisma.$queryRawUnsafe<QueueNotifRow[]>(
    `SELECT id, last_position, last_notified_at
     FROM ${quoteIdent(schemaName)}.queue_notifications
     WHERE conversation_id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  const existing = existingRows[0];

  if (existing) {
    const secondsSinceLast = (Date.now() - new Date(existing.last_notified_at).getTime()) / 1000;
    const positionUnchanged = existing.last_position === position;
    if (positionUnchanged && secondsSinceLast < settings.queue_throttle_seconds) {
      return;
    }
  }

  const rendered = renderTemplate(settings.queue_message_template, {
    position: escapeWhatsAppMarkdown(String(position)),
  });

  const messageId = await sendSystemWhatsAppMessage(schemaName, tenantId, conversationId, rendered);
  if (!messageId) return;

  // Upsert queue_notifications
  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdent(schemaName)}.queue_notifications
       SET last_position = $1, last_notified_at = NOW(), message_id = $2
       WHERE conversation_id = $3::uuid`,
      position,
      messageId,
      conversationId,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quoteIdent(schemaName)}.queue_notifications
         (conversation_id, last_position, last_notified_at, message_id)
       VALUES ($1::uuid, $2, NOW(), $3)
       ON CONFLICT DO NOTHING`,
      conversationId,
      position,
      messageId,
    );
  }

  await auditQueueNotification(schemaName, conversationId, 'conversation.queue.notified', {
    position,
    message_id: messageId,
  });
}

export async function notifyAgentAssumed(
  schemaName: string,
  tenantId: string,
  conversationId: string,
  agentUserId: string,
): Promise<void> {
  const settings = await getTenantQueueSettings(tenantId);
  if (!settings.queue_notifications_enabled) return;

  const agentRows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM ${quoteIdent(schemaName)}.users WHERE id = $1::uuid LIMIT 1`,
    agentUserId,
  );
  const agentName = agentRows[0]?.name ?? 'Agente';

  const rendered = renderTemplate(settings.agent_assume_template, {
    agent_name: escapeWhatsAppMarkdown(agentName),
  });

  const messageId = await sendSystemWhatsAppMessage(schemaName, tenantId, conversationId, rendered);
  if (!messageId) return;

  await auditQueueNotification(schemaName, conversationId, 'conversation.queue.agent_assumed', {
    agent_user_id: agentUserId,
    agent_name: agentName,
    message_id: messageId,
  });
}

export async function handle24hWindowExpiration(
  schemaName: string,
  tenantId: string,
): Promise<void> {
  const settings = await getTenantQueueSettings(tenantId);

  const expiredRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM ${quoteIdent(schemaName)}.conversations
     WHERE assigned_to IS NULL
       AND status = 'open'
       AND COALESCE(metadata->>'bot_stage', '') <> 'waiting_choice'
       AND COALESCE(metadata->>'ai_agent_active', 'false') <> 'true'
       AND queue_entered_at < NOW() - INTERVAL '24 hours'`,
  );

  for (const row of expiredRows) {
    try {
      if (settings.expire_24h_action === 'close') {
        await sendSystemWhatsAppMessage(
          schemaName,
          tenantId,
          row.id,
          settings.expire_24h_message,
        );

        await prisma.$executeRawUnsafe(
          `UPDATE ${quoteIdent(schemaName)}.conversations
           SET status = 'closed',
               closure_reason = $2::jsonb,
               queue_entered_at = NULL,
               closed_at = NOW()
           WHERE id = $1::uuid`,
          row.id,
          JSON.stringify({ type: 'expired_24h' }),
        );

        await auditQueueNotification(schemaName, row.id, 'conversation.queue.expired_24h', {
          action: 'close',
        });
      }
      // 'keep_open': do nothing
    } catch (err) {
      logger.error({ err, conversationId: row.id }, '[QueueNotif] Error handling 24h expiration');
    }
  }
}
