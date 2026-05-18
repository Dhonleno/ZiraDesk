import { prisma } from '../../../config/database.js';
import { decryptCredentials } from '../../../utils/crypto.js';
import { logger } from '../../../config/logger.js';
import { ensureConversationCsatInfrastructure } from './csat.infrastructure.js';

type CsatTxClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;
type CsatDbClient = CsatTxClient & Pick<typeof prisma, '$transaction'>;

interface CsatConversationRow {
  id: string;
  channel_type: string;
  contact_whatsapp: string | null;
  contact_phone: string | null;
  channel_credentials: string | object | null;
  csat_stage: string | null;
  csat_score: number | null;
  csat_sent_at: Date | null;
  metadata: unknown;
}

interface TenantSettingsRow {
  settings: unknown;
}

const DEFAULT_CSAT_MESSAGE_LINES = [
  'Seu atendimento foi encerrado! 😊',
  '',
  'Como você avalia nosso atendimento?',
  '',
  '1 ⭐ - Muito ruim',
  '2 ⭐⭐ - Ruim',
  '3 ⭐⭐⭐ - Regular',
  '4 ⭐⭐⭐⭐ - Bom',
  '5 ⭐⭐⭐⭐⭐ - Excelente',
  '',
  'Digite o número da sua avaliação.',
];

export function buildDefaultCsatMessage(): string {
  return DEFAULT_CSAT_MESSAGE_LINES.join('\n');
}

export function buildCsatCommentRequestMessage(score: number): string {
  const stars = '⭐'.repeat(score);
  return [
    `Obrigado pela sua avaliação! ${stars}`,
    '',
    'Gostaria de deixar um comentário?',
    'Responda com seu comentário ou',
    'digite 0 para encerrar.',
  ].join('\n');
}

export function buildCsatInvalidScoreMessage(): string {
  return 'Por favor, digite um número de 1 a 5 para avaliar.';
}

export function buildCsatThankYouMessage(): string {
  return ['Agradecemos seu feedback!', 'Até a próxima. 😊'].join('\n');
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, '');
}

function extractConversationOrigin(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  const origin = record.origin;
  return typeof origin === 'string' && origin.trim() ? origin.trim() : null;
}

export async function sendWhatsAppTextMessage({
  text,
  to,
  phoneNumberId,
  accessToken,
}: {
  text: string;
  to: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<boolean> {
  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo || !phoneNumberId || !accessToken) return false;

  const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    logger.error({ status: response.status, details: details.substring(0, 500) }, '[CSAT] Failed to send WhatsApp message');
    return false;
  }

  return true;
}

export async function sendCsatMessage(
  conversationId: string,
  schemaName: string,
  db: CsatDbClient,
): Promise<void> {
  await ensureConversationCsatInfrastructure(db, schemaName);

  const safeSchemaName = schemaName.replace(/"/g, '""');
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);

    const rows = await tx.$queryRawUnsafe<CsatConversationRow[]>(
      `SELECT
         c.id,
         c.channel_type,
         c.csat_stage,
         c.csat_score,
         c.csat_sent_at,
         c.metadata,
         ct.whatsapp AS contact_whatsapp,
         ct.phone AS contact_phone,
         ch.credentials AS channel_credentials
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN channels ch ON ch.id = c.channel_id
       WHERE c.id = $1::uuid
       FOR UPDATE OF c
       LIMIT 1`,
      conversationId,
    );
    const conversation = rows[0];
    if (!conversation) return;
    if (conversation.channel_type !== 'whatsapp') return;
    const origin = extractConversationOrigin(conversation.metadata);
    const isLegacyActiveOutbound = conversation.metadata
      && typeof conversation.metadata === 'object'
      && (conversation.metadata as Record<string, unknown>).active_outbound === true;
    if (origin === 'active_outbound' || isLegacyActiveOutbound) {
      logger.info({ conversationId }, '[CSAT] Skipping — active_outbound origin');
      return;
    }

    if (conversation.csat_score !== null && conversation.csat_score !== undefined) {
      logger.info({ conversationId }, '[CSAT] Already rated — skipping');
      return;
    }
    if (conversation.csat_stage === 'done') {
      logger.info({ conversationId }, '[CSAT] Already done — skipping');
      return;
    }
    if (conversation.csat_stage === 'sent' || conversation.csat_stage === 'waiting_comment') {
      logger.info({ conversationId, csatStage: conversation.csat_stage }, '[CSAT] Already in progress — skipping');
      return;
    }
    if (conversation.csat_sent_at) {
      logger.info({ conversationId }, '[CSAT] Already sent — skipping');
      return;
    }

    const tenantRows = await tx.$queryRawUnsafe<TenantSettingsRow[]>(
      `SELECT settings
       FROM tenants
       WHERE schema_name = $1
       LIMIT 1`,
      schemaName,
    );
    const settings = (tenantRows[0]?.settings as Record<string, unknown> | null) ?? {};
    if (settings.csat_enabled === false) return;

    const csatExpirationHours =
      typeof settings.csatExpirationHours === 'number' &&
      settings.csatExpirationHours >= 1 &&
      settings.csatExpirationHours <= 720
        ? Math.trunc(settings.csatExpirationHours)
        : 48;

    const csatText =
      typeof settings.csat_message === 'string' && settings.csat_message.trim()
        ? settings.csat_message.trim()
        : buildDefaultCsatMessage();

    const clientPhone = normalizePhoneNumber(conversation.contact_whatsapp ?? conversation.contact_phone ?? '');
    if (!clientPhone) return;

    const credentials = conversation.channel_credentials
      ? decryptCredentials(conversation.channel_credentials)
      : {};
    const phoneNumberId = credentials.phoneNumberId ?? credentials.phone_number_id;
    const accessToken = credentials.accessToken ?? credentials.access_token;
    if (!phoneNumberId || !accessToken) return;

    const sent = await sendWhatsAppTextMessage({
      text: csatText,
      to: clientPhone,
      phoneNumberId,
      accessToken,
    });
    if (!sent) return;

    await tx.$executeRawUnsafe(
      `UPDATE conversations
       SET csat_sent_at = NOW(),
           csat_stage = 'sent',
           csat_expires_at = NOW() + ($1 * INTERVAL '1 hour')
       WHERE id = $2::uuid`,
      csatExpirationHours,
      conversationId,
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO messages (id, conversation_id, sender_type, content, content_type, is_internal, created_at)
       VALUES (gen_random_uuid(), $1::uuid, 'bot', $2, 'text', false, NOW())`,
      conversationId,
      csatText,
    );

    logger.info({ conversationId }, '[CSAT] Sent');
  });
}
