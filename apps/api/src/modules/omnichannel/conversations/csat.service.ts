import { prisma } from '../../../config/database.js';
import { decryptCredentials } from '../../../utils/crypto.js';
import { ensureConversationCsatInfrastructure } from './csat.infrastructure.js';

type CsatDbClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;

interface CsatConversationRow {
  id: string;
  channel_type: string;
  contact_whatsapp: string | null;
  contact_phone: string | null;
  channel_credentials: string | object | null;
  csat_stage: string | null;
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
    console.error('[CSAT] Failed to send WhatsApp message', {
      status: response.status,
      details: details.substring(0, 500),
    });
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
  await db.$executeRawUnsafe(`SET search_path TO "${safeSchemaName}", public`);

  const rows = await db.$queryRawUnsafe<CsatConversationRow[]>(
    `SELECT
       c.id,
       c.channel_type,
       c.csat_stage,
       ct.whatsapp AS contact_whatsapp,
       ct.phone AS contact_phone,
       ch.credentials AS channel_credentials
     FROM conversations c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid
     LIMIT 1`,
    conversationId,
  );
  const conversation = rows[0];
  if (!conversation) return;
  if (conversation.channel_type !== 'whatsapp') return;
  if (conversation.csat_stage) return;

  const tenantRows = await db.$queryRawUnsafe<TenantSettingsRow[]>(
    `SELECT settings
     FROM tenants
     WHERE schema_name = $1
     LIMIT 1`,
    schemaName,
  );
  const settings = (tenantRows[0]?.settings as Record<string, unknown> | null) ?? {};
  if (settings.csat_enabled === false) return;

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

  await db.$executeRawUnsafe(
    `UPDATE conversations
     SET csat_sent_at = NOW(),
         csat_stage = 'sent'
     WHERE id = $1::uuid`,
    conversationId,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO messages (id, conversation_id, sender_type, content, content_type, is_internal, created_at)
     VALUES (gen_random_uuid(), $1::uuid, 'bot', $2, 'text', false, NOW())`,
    conversationId,
    csatText,
  );

  console.log(`[CSAT] Sent to conversation ${conversationId}`);
}
