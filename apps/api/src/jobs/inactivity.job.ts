import { Queue, Worker, type Job } from 'bullmq';
import { prisma } from '../config/database.js';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';
import { decryptCredentials } from '../utils/crypto.js';
import { sendWhatsAppTextMessage } from '../modules/omnichannel/conversations/csat.service.js';
import { getSocketServer } from '../socket/index.js';
import { syncAgentAvailability } from '../modules/omnichannel/conversations/auto-assign.service.js';

type InactivityType = 'warning' | 'close';

interface InactivityJobData {
  conversationId: string;
  tenantId: string;
  schemaName: string;
  type: InactivityType;
}

interface InactivityConversationRow {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  assigned_to: string | null;
  last_message_at: Date | null;
  created_at: Date;
  whatsapp: string | null;
  phone: string | null;
  credentials: string | object | null;
  channel_type: string;
}

interface TenantSettingsRow {
  settings: unknown;
}

export interface InactivitySettings {
  enabled: boolean;
  warningMinutes: number;
  closeMinutes: number;
  warningMessage: string;
  closeMessage: string;
}

const DEFAULT_WARNING_MINUTES = 30;
const DEFAULT_CLOSE_MINUTES = 60;
const DEFAULT_WARNING_MESSAGE =
  'Olá! Notamos que você está inativo há {{time}}. Seu atendimento será encerrado em {{remaining}} minutos caso não haja interação.';
const DEFAULT_CLOSE_MESSAGE =
  'Seu atendimento foi encerrado por inatividade. Caso precise de ajuda, entre em contato novamente. 😊';

export const inactivityQueue = new Queue<InactivityJobData>('ziradesk-inactivity', {
  connection: bullmqConnection,
});

function normalizeMinutes(value: unknown, fallback: number, minimum: number): number {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return fallback;
  return Math.max(minimum, Math.floor(asNumber));
}

function parseInactivitySettings(settings: unknown): InactivitySettings {
  const safe = (typeof settings === 'object' && settings !== null)
    ? (settings as Record<string, unknown>)
    : {};

  const warningMinutes = normalizeMinutes(
    safe.inactivity_warning_minutes,
    DEFAULT_WARNING_MINUTES,
    1,
  );
  const closeCandidate = normalizeMinutes(
    safe.inactivity_close_minutes,
    DEFAULT_CLOSE_MINUTES,
    warningMinutes + 1,
  );
  const closeMinutes = closeCandidate > warningMinutes
    ? closeCandidate
    : warningMinutes + 1;

  return {
    enabled: safe.inactivity_enabled !== false,
    warningMinutes,
    closeMinutes,
    warningMessage: typeof safe.inactivity_warning_message === 'string' && safe.inactivity_warning_message.trim()
      ? safe.inactivity_warning_message.trim()
      : DEFAULT_WARNING_MESSAGE,
    closeMessage: typeof safe.inactivity_close_message === 'string' && safe.inactivity_close_message.trim()
      ? safe.inactivity_close_message.trim()
      : DEFAULT_CLOSE_MESSAGE,
  };
}

export async function getTenantInactivitySettings(tenantId: string): Promise<InactivitySettings> {
  const rows = await prisma.$queryRawUnsafe<TenantSettingsRow[]>(
    'SELECT settings FROM tenants WHERE id = $1 LIMIT 1',
    tenantId,
  );
  return parseInactivitySettings(rows[0]?.settings);
}

async function insertBotMessage(
  conversationId: string,
  schemaName: string,
  content: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${quoteIdent(schemaName)}.messages (
      id, conversation_id, sender_type, content, content_type, is_internal, created_at
    )
    VALUES (
      gen_random_uuid(), $1::uuid, 'bot', $2, 'text', false, NOW()
    )`,
    conversationId,
    content,
  );
}

async function loadConversation(
  conversationId: string,
  schemaName: string,
): Promise<InactivityConversationRow | null> {
  const rows = await prisma.$queryRawUnsafe<InactivityConversationRow[]>(
    `SELECT
       c.id,
       c.status,
       c.metadata,
       c.assigned_to,
       c.last_message_at,
       c.created_at,
       ct.whatsapp,
       ct.phone,
       ch.credentials,
       ch.type AS channel_type
     FROM ${quoteIdent(schemaName)}.conversations c
     JOIN ${quoteIdent(schemaName)}.contacts ct ON ct.id = c.contact_id
     JOIN ${quoteIdent(schemaName)}.channels ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid
       AND c.status IN ('open', 'waiting')
     LIMIT 1`,
    conversationId,
  );

  return rows[0] ?? null;
}

async function sendConversationWhatsAppText(
  conversation: InactivityConversationRow,
  text: string,
): Promise<boolean> {
  if (conversation.channel_type !== 'whatsapp') return false;

  const credentials = conversation.credentials ? decryptCredentials(conversation.credentials) : {};
  const phoneNumberId = credentials.phoneNumberId ?? credentials.phone_number_id;
  const accessToken = credentials.accessToken ?? credentials.access_token;
  const phone = (conversation.whatsapp ?? conversation.phone ?? '').replace(/\D/g, '');
  if (!phoneNumberId || !accessToken || !phone) return false;

  return sendWhatsAppTextMessage({
    text,
    to: phone,
    phoneNumberId,
    accessToken,
  });
}

async function processInactivity(jobData: InactivityJobData): Promise<void> {
  const { conversationId, tenantId, schemaName, type } = jobData;
  const conversation = await loadConversation(conversationId, schemaName);
  if (!conversation) return;

  const settings = await getTenantInactivitySettings(tenantId);
  if (!settings.enabled) return;

  const baseDate = conversation.last_message_at ?? conversation.created_at;
  const minutesSinceActivity = (Date.now() - baseDate.getTime()) / 60000;

  if (type === 'warning') {
    if (minutesSinceActivity < settings.warningMinutes - 1) return;

    const remaining = Math.max(1, settings.closeMinutes - settings.warningMinutes);
    const warningText = settings.warningMessage
      .replaceAll('{{time}}', `${settings.warningMinutes} minutos`)
      .replaceAll('{{remaining}}', String(remaining));

    const sent = await sendConversationWhatsAppText(conversation, warningText);
    if (sent) {
      await insertBotMessage(conversationId, schemaName, warningText);
    }

    const io = getSocketServer();
    io.to(`tenant:${tenantId}`).emit('conversation:message', {
      conversationId,
      message: {
        content: warningText,
        senderType: 'bot',
        createdAt: new Date().toISOString(),
      },
      conversation: {
        id: conversation.id,
        status: conversation.status,
        metadata: conversation.metadata,
        assigned_to: conversation.assigned_to,
      },
    });

    await inactivityQueue.add(
      'check-inactivity',
      { conversationId, tenantId, schemaName, type: 'close' },
      {
        delay: remaining * 60 * 1000,
        jobId: `close-${conversationId}`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    return;
  }

  if (minutesSinceActivity < settings.closeMinutes - 1) return;

  const closeText = settings.closeMessage;
  const closeSent = await sendConversationWhatsAppText(conversation, closeText);
  if (closeSent) {
    await insertBotMessage(conversationId, schemaName, closeText);
  }

  const io = getSocketServer();
  io.to(`tenant:${tenantId}`).emit('conversation:message', {
    conversationId,
    message: {
      content: closeText,
      senderType: 'bot',
      createdAt: new Date().toISOString(),
    },
    conversation: {
      id: conversation.id,
      status: conversation.status,
      metadata: conversation.metadata,
      assigned_to: conversation.assigned_to,
    },
  });

  await prisma.$executeRawUnsafe(
    `UPDATE ${quoteIdent(schemaName)}.conversations
     SET status = 'closed',
         resolved_at = NOW(),
         closure_reason = $2::jsonb,
         waiting_expires_at = NULL
     WHERE id = $1::uuid
       AND status IN ('open', 'waiting')`,
    conversationId,
    JSON.stringify({
      reason: 'inactivity',
      notes: 'Encerrado por inatividade',
      resolvedAt: new Date(),
      agentId: null,
    }),
  );

  await syncAgentAvailability(prisma, schemaName, [conversation.assigned_to], tenantId);

  io.to(`tenant:${tenantId}`).emit('conversation:updated', {
    conversationId,
    status: 'closed',
  });

  logger.info({ conversationId }, '[Inactivity] Conversation closed');
}

const inactivityWorker = new Worker<InactivityJobData>(
  'ziradesk-inactivity',
  async (job) => {
    await processInactivity(job.data);
  },
  { connection: bullmqConnection },
);

inactivityWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, '[Inactivity] Job failed');
});

export async function cancelInactivityJobs(conversationId: string): Promise<void> {
  await inactivityQueue.remove(`warning-${conversationId}`);
  await inactivityQueue.remove(`close-${conversationId}`);

  const pendingJobs = await inactivityQueue.getJobs(['delayed', 'waiting']);
  const jobsFromConversation = pendingJobs.filter((job: Job<InactivityJobData>) => {
    return job.data?.conversationId === conversationId;
  });

  await Promise.all(jobsFromConversation.map(async (job) => {
    await job.remove();
  }));
}

export async function scheduleInactivityCheck(
  conversationId: string,
  tenantId: string,
  schemaName: string,
  warningMinutes: number,
): Promise<void> {
  const normalizedWarning = normalizeMinutes(warningMinutes, DEFAULT_WARNING_MINUTES, 1);
  await cancelInactivityJobs(conversationId);
  await inactivityQueue.add(
    'check-inactivity',
    { conversationId, tenantId, schemaName, type: 'warning' },
    {
      delay: normalizedWarning * 60 * 1000,
      jobId: `warning-${conversationId}`,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

