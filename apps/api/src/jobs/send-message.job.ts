import { Worker } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { sendEmail } from '../services/email.service.js';
import { incrementUsage } from '../services/usage.service.js';
import { getSocketServer } from '../socket/index.js';
import { completeCampaignIfSettled } from '../modules/omnichannel/campaigns/campaign-delivery.service.js';
import { closeFailedInitialOutbound } from '../modules/omnichannel/outbound-failure.service.js';
import { normalizePhoneForStorage } from '../utils/phone.js';
import {
  buildFinalMetaFailureReason,
  getProcessorAttemptLimit,
  isLastProcessorAttempt,
  isRetryableMetaError,
} from './message-delivery-policy.js';

interface SendMessageJob {
  messageId: string;
  conversationId: string;
  tenantId?: string | null;
  tenantSchema?: string | null;
  channelType: 'whatsapp' | 'instagram' | 'email';
  channelCredentials: Record<string, string>;
  content: string;
  to: string;
  mediaId?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateComponents?: Array<Record<string, unknown>> | null;
  replyToExternalId?: string | null;
  replyToMessageId?: string | null;
}

interface MetaApiErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    error_data?: {
      details?: string;
    };
  };
}

function parseMetaApiError(responseText: string): {
  code: number | null;
  message: string | null;
  details: string | null;
} {
  try {
    const parsed = JSON.parse(responseText) as MetaApiErrorResponse;
    return {
      code: typeof parsed.error?.code === 'number' ? parsed.error.code : null,
      message: parsed.error?.message?.trim() ?? null,
      details: parsed.error?.error_data?.details?.trim() ?? null,
    };
  } catch {
    return {
      code: null,
      message: null,
      details: null,
    };
  }
}

function buildTemplateLanguageFallbacks(language: string): string[] {
  const normalized = language.trim();
  const fallbackOrder: string[] = [];
  const push = (value: string) => {
    const candidate = value.trim();
    if (!candidate || candidate.toLowerCase() === normalized.toLowerCase()) return;
    if (fallbackOrder.some((item) => item.toLowerCase() === candidate.toLowerCase())) return;
    fallbackOrder.push(candidate);
  };

  const baseLanguage = normalized.includes('_')
    ? normalized.split('_')[0]
    : normalized.slice(0, 2);
  if (baseLanguage) push(baseLanguage);

  if (normalized.toLowerCase() === 'pt_br') {
    push('pt_PT');
  } else if (normalized.toLowerCase() === 'en_us') {
    push('en_GB');
  } else if (normalized.toLowerCase() === 'es') {
    push('es_ES');
    push('es_MX');
  }

  return fallbackOrder;
}

function normalizeWhatsappText(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n');
}

function sanitizeWhatsAppRecipientForMeta(to: string): string {
  if (env.NODE_ENV !== 'development') {
    return to.replace(/\D/g, '');
  }

  const digits = to.replace(/\D/g, '');
  const normalizationInput =
    digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
      ? digits
      : to;

  try {
    return (normalizePhoneForStorage(normalizationInput) ?? to).replace(/\D/g, '');
  } catch {
    return digits;
  }
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}


async function resolveSchemaName(job: SendMessageJob): Promise<string | null> {
  if (job.tenantSchema) return job.tenantSchema;
  if (!job.tenantId) return null;

  const tenant = await prisma.tenant.findUnique({
    where: { id: job.tenantId },
    select: { schemaName: true },
  });

  return tenant?.schemaName ?? null;
}

async function persistExternalId(job: SendMessageJob, externalId: string): Promise<void> {
  const schemaName = await resolveSchemaName(job);
  if (!schemaName) {
    logger.warn({ tenantId: job.tenantId, messageId: job.messageId }, '[WhatsApp Worker] Could not resolve tenant schema to persist external_id');
    return;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${quoteIdent(schemaName)}.messages
     SET external_id = $1, status = 'sent'
     WHERE id = $2::uuid`,
    externalId,
    job.messageId,
  );

  await syncCampaignMessageSent(job, externalId, schemaName);
}

async function persistSentStatus(job: SendMessageJob): Promise<void> {
  const schemaName = await resolveSchemaName(job);
  if (!schemaName) return;

  await prisma.$executeRawUnsafe(
    `UPDATE ${quoteIdent(schemaName)}.messages
     SET status = 'sent'
     WHERE id = $1::uuid`,
    job.messageId,
  );

  await syncCampaignMessageSent(job, null, schemaName);
}

async function persistFailedStatus(
  job: SendMessageJob,
  metadataPatch: Record<string, unknown>,
): Promise<void> {
  const schemaName = await resolveSchemaName(job);
  if (!schemaName) {
    logger.warn({ tenantId: job.tenantId, messageId: job.messageId }, '[WhatsApp Worker] Could not resolve tenant schema to persist failed status');
    return;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${quoteIdent(schemaName)}.messages
     SET status = 'failed',
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $1::uuid`,
    job.messageId,
    JSON.stringify(metadataPatch),
  );

  await syncCampaignMessageFailed(job, metadataPatch, schemaName);
}

async function syncCampaignMessageSent(
  job: SendMessageJob,
  externalId: string | null,
  schemaName: string,
): Promise<void> {
  try {
    const updatedRows = await prisma.$queryRawUnsafe<Array<{ campaign_id: string }>>(
      `UPDATE ${quoteIdent(schemaName)}.campaign_contacts cc
       SET status = 'sent',
           sent_at = COALESCE(sent_at, NOW()),
           message_id = COALESCE(cc.message_id, $1)
       WHERE cc.conversation_id = $2::uuid
         AND cc.status = 'queued'
       RETURNING cc.campaign_id::text`,
      externalId,
      job.conversationId,
    );
    const campaignId = updatedRows[0]?.campaign_id;
    if (!campaignId) return;

    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdent(schemaName)}.campaigns
       SET sent_count = sent_count + $2::integer,
           updated_at = NOW()
       WHERE id = $1::uuid`,
      campaignId,
      updatedRows.length,
    );
    await completeCampaignIfSettled(schemaName, campaignId);
  } catch (error) {
    logger.warn(
      { error, messageId: job.messageId, conversationId: job.conversationId },
      '[CampaignSend] Failed to sync sent message id',
    );
  }
}

async function syncCampaignMessageFailed(
  job: SendMessageJob,
  metadataPatch: Record<string, unknown>,
  schemaName: string,
): Promise<void> {
  const reason =
    String(metadataPatch['whatsapp_send_error_details'] ?? '')
      || String(metadataPatch['whatsapp_send_error_message'] ?? '')
      || String(metadataPatch['whatsapp_send_error'] ?? '')
      || String(metadataPatch['instagram_send_error_message'] ?? '')
      || String(metadataPatch['instagram_send_error'] ?? '')
      || String(metadataPatch['email_send_error'] ?? '')
      || String(metadataPatch['delivery_error'] ?? '')
      || 'Falha ao enviar mensagem';

  try {
    const updatedRows = await prisma.$queryRawUnsafe<Array<{ campaign_id: string; previous_status: string }>>(
      `WITH target AS (
         SELECT id, campaign_id, status AS previous_status
         FROM ${quoteIdent(schemaName)}.campaign_contacts
         WHERE conversation_id = $2::uuid
           AND status NOT IN ('failed', 'delivered', 'read', 'replied', 'opted_out')
       ),
       updated AS (
         UPDATE ${quoteIdent(schemaName)}.campaign_contacts cc
         SET status = 'failed',
             error_message = $1,
             failed_at = NOW()
         FROM target
         WHERE cc.id = target.id
         RETURNING target.campaign_id::text, target.previous_status
       )
       SELECT campaign_id, previous_status FROM updated`,
      reason.slice(0, 500),
      job.conversationId,
    );

    const campaignId = updatedRows[0]?.campaign_id;
    if (!campaignId) return;

    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdent(schemaName)}.campaigns
       SET failed_count = failed_count + $2::integer,
           updated_at = NOW()
       WHERE id = $1::uuid`,
      campaignId,
      updatedRows.length,
    );
    await completeCampaignIfSettled(schemaName, campaignId);
  } catch (error) {
    logger.warn(
      { error, messageId: job.messageId, conversationId: job.conversationId },
      '[CampaignSend] Failed to sync message failure',
    );
  }
}

async function handlePermanentDeliveryFailure(
  job: SendMessageJob,
  metadataPatch: Record<string, unknown>,
  reason: string,
): Promise<void> {
  await persistFailedStatus(job, metadataPatch);
  const schemaName = await resolveSchemaName(job);
  if (schemaName) {
    await closeFailedInitialOutbound({
      schemaName,
      conversationId: job.conversationId,
      messageId: job.messageId,
      provider: job.channelType,
      reason,
      tenantId: job.tenantId ?? null,
    });
  }
  await notifyPermanentMessageFailure(job, reason);
}

async function notifyPermanentMessageFailure(job: SendMessageJob, reason: string): Promise<void> {
  const schemaName = await resolveSchemaName(job);
  if (!schemaName) return;

  try {
    const conversationRows = await prisma.$queryRawUnsafe<Array<{
      assigned_to: string | null;
      contact_name: string | null;
    }>>(
      `SELECT c.assigned_to, ct.name AS contact_name
       FROM ${quoteIdent(schemaName)}.conversations c
       LEFT JOIN ${quoteIdent(schemaName)}.contacts ct ON ct.id = c.contact_id
       WHERE c.id = $1::uuid
       LIMIT 1`,
      job.conversationId,
    );
    const conversation = conversationRows[0];
    const assignedTo = conversation?.assigned_to ?? null;
    const contactName = conversation?.contact_name ?? 'contato';
    const messageBody = `A mensagem inicial para ${contactName} falhou: ${reason}`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quoteIdent(schemaName)}.audit_logs
         (user_id, action, entity, entity_id, new_data)
       SELECT $1::uuid, 'message.failed', 'conversation', $2::uuid, $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1
         FROM ${quoteIdent(schemaName)}.audit_logs
         WHERE action = 'message.failed'
           AND entity_id = $2::uuid
           AND new_data->>'message_id' = $4
       )`,
      assignedTo,
      job.conversationId,
      JSON.stringify({
        assigned_to: assignedTo,
        type: 'message_failed',
        title: 'Mensagem não entregue',
        body: messageBody,
        message_id: job.messageId,
        reason,
        contact_name: contactName,
      }),
      job.messageId,
    );

    const payload = {
      conversationId: job.conversationId,
      messageId: job.messageId,
      reason,
    };
    const io = getSocketServer();
    if (job.tenantId) io.to(`tenant:${job.tenantId}`).emit('conversation:message_failed', payload);
    if (assignedTo) {
      io.to(`agent:${assignedTo}`).emit('notification:new', {
        type: 'message_failed',
        title: 'Mensagem não entregue',
        message: messageBody,
        href: `/omnichannel/conversations?conversation=${job.conversationId}`,
      });
    }
  } catch (error) {
    logger.error(
      { error, messageId: job.messageId, conversationId: job.conversationId },
      '[Message Worker] Failed to create permanent failure notification',
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveReplyExternalId(job: SendMessageJob): Promise<string | null> {
  if (job.replyToExternalId?.trim()) return job.replyToExternalId.trim();
  if (!job.replyToMessageId) return null;

  const schemaName = await resolveSchemaName(job);
  if (!schemaName) return null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await prisma.$queryRawUnsafe<Array<{ external_id: string | null }>>(
      `SELECT external_id
       FROM ${quoteIdent(schemaName)}.messages
       WHERE id = $1::uuid
       LIMIT 1`,
      job.replyToMessageId,
    );
    const resolved = rows[0]?.external_id?.trim() ?? null;
    if (resolved) return resolved;
    if (attempt < 3) await sleep(350);
  }

  return null;
}

function buildWhatsAppBody(job: SendMessageJob, sanitizedPhone: string, replyExternalId: string | null) {
  const normalizedContent = normalizeWhatsappText(job.content ?? '');
  const context = replyExternalId
    ? { context: { message_id: replyExternalId } }
    : {};
  const templateName = job.templateName?.trim() ?? '';
  const templateLanguage = job.templateLanguage?.trim() || 'pt_BR';
  const templateComponents = Array.isArray(job.templateComponents)
    ? job.templateComponents.filter(
      (component): component is Record<string, unknown> => Boolean(component) && typeof component === 'object',
    )
    : [];

  const normalizedTemplateComponents = (() => {
    if (templateComponents.length === 0) {
      return [{ type: 'body', parameters: [] as Array<Record<string, unknown>> }];
    }

    const componentsWithBodyParameters = templateComponents.map((component) => {
      const type = typeof component.type === 'string' ? component.type.toLowerCase() : '';
      if (type !== 'body') return component;
      const parameters = Array.isArray(component.parameters) ? component.parameters : [];
      return { ...component, parameters };
    });

    const hasBody = componentsWithBodyParameters.some((component) => {
      const type = typeof component.type === 'string' ? component.type.toLowerCase() : '';
      return type === 'body';
    });

    if (hasBody) return componentsWithBodyParameters;

    return [
      ...componentsWithBodyParameters,
      { type: 'body', parameters: [] as Array<Record<string, unknown>> },
    ];
  })();

  if (templateName) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sanitizedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: templateLanguage,
        },
        components: normalizedTemplateComponents,
      },
      ...context,
    };
  }

  if (!job.mediaId || !job.mediaType) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sanitizedPhone,
      type: 'text',
      text: { body: normalizedContent },
      ...context,
    };
  }

  const mediaTypeRaw = (job.mediaType ?? '').toLowerCase();
  const mediaGroup = mediaTypeRaw.includes('/') ? mediaTypeRaw.split('/')[0] : mediaTypeRaw;
  const isDocumentByType = mediaTypeRaw === 'document' || mediaGroup === 'application' || mediaGroup === 'text';
  const caption = normalizedContent.trim() || undefined;
  switch (mediaGroup) {
    case 'image':
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'image',
        image: { id: job.mediaId, ...(caption ? { caption } : {}) },
        ...context,
      };
    case 'audio':
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'audio',
        audio: { id: job.mediaId },
        ...context,
      };
    case 'video':
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'video',
        video: { id: job.mediaId, ...(caption ? { caption } : {}) },
        ...context,
      };
    case 'application':
    case 'text':
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'document',
        document: {
          id: job.mediaId,
          filename: job.mediaFilename ?? 'documento',
          ...(caption ? { caption } : {}),
        },
        ...context,
      };
    default:
      if (isDocumentByType) {
        return {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: sanitizedPhone,
          type: 'document',
          document: {
            id: job.mediaId,
            filename: job.mediaFilename ?? 'documento',
            ...(caption ? { caption } : {}),
          },
          ...context,
        };
      }
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'text',
        text: { body: normalizedContent },
        ...context,
      };
  }
}

const worker = new Worker<SendMessageJob>(
  'ziradesk-messages',
  async (job) => {
    const { channelType, channelCredentials } = job.data;
    logger.info({ jobId: job.id, channelType }, '[WhatsApp Worker] Executing job');

    switch (channelType) {
      case 'whatsapp': {
        const phoneNumberId =
          channelCredentials['phoneNumberId'] ??
          channelCredentials['phone_number_id'] ??
          env.WHATSAPP_PHONE_NUMBER_ID;
        const accessToken =
          channelCredentials['accessToken'] ??
          channelCredentials['access_token'] ??
          env.WHATSAPP_ACCESS_TOKEN;

        if (!phoneNumberId || !accessToken) {
          const reason = 'Credenciais do WhatsApp não configuradas para o canal remetente';
          await handlePermanentDeliveryFailure(job.data, {
            whatsapp_send_error: 'missing_credentials',
            whatsapp_send_failed_at: new Date().toISOString(),
          }, reason);
          return { ok: false, permanent: true };
        }
        // Meta Cloud API requires digits only: no +, spaces, hyphens or parentheses.
        const sanitizedPhone = sanitizeWhatsAppRecipientForMeta(job.data.to ?? '');
        const replyExternalId = await resolveReplyExternalId(job.data);
        const sendToMeta = async (payload: ReturnType<typeof buildWhatsAppBody>) => {
          const response = await fetch(
            `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${phoneNumberId}/messages`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            },
          );
          const responseText = await response.text();
          return { response, responseText };
        };

        const primaryBody = buildWhatsAppBody(job.data, sanitizedPhone, replyExternalId);
        let { response, responseText } = await sendToMeta(primaryBody);

        if (!response.ok) {
          const metaError = parseMetaApiError(responseText);
          const templateName = job.data.templateName?.trim() ?? '';
          const templateLanguage = job.data.templateLanguage?.trim() || 'pt_BR';

          if (templateName && metaError.code === 132001) {
            const fallbackLanguages = buildTemplateLanguageFallbacks(templateLanguage);
            for (const fallbackLanguage of fallbackLanguages) {
              const fallbackBody = buildWhatsAppBody(
                { ...job.data, templateLanguage: fallbackLanguage },
                sanitizedPhone,
                replyExternalId,
              );
              const fallbackResult = await sendToMeta(fallbackBody);
              if (fallbackResult.response.ok) {
                response = fallbackResult.response;
                responseText = fallbackResult.responseText;
                logger.warn(
                  { jobId: job.id, messageId: job.data.messageId, templateName, requestedLanguage: templateLanguage, fallbackLanguage },
                  '[WhatsApp Worker] Template sent with fallback language',
                );
                break;
              }
            }
          }
        }

        if (!response.ok) {
          const metaError = parseMetaApiError(responseText);
          const metadataPatch = {
            whatsapp_send_http_status: response.status,
            whatsapp_send_error_code: metaError.code,
            whatsapp_send_error_message: metaError.message,
            whatsapp_send_error_details: metaError.details,
            whatsapp_send_attempts: job.attemptsMade + 1,
            whatsapp_send_failed_at: new Date().toISOString(),
          };
          const providerReason = metaError.details || metaError.message || `Meta API HTTP ${response.status}`;
          const retryable = isRetryableMetaError(response.status, metaError.code);

          if (!retryable || isLastProcessorAttempt(job)) {
            const reason = buildFinalMetaFailureReason({
              fallback: providerReason,
              retryable,
              errorCode: metaError.code,
              attempts: getProcessorAttemptLimit(job),
            });
            await handlePermanentDeliveryFailure(job.data, metadataPatch, reason);
            return { ok: false, permanent: !retryable };
          }

          throw new Error(`Meta API error: ${responseText}`);
        }

        try {
          const result = JSON.parse(responseText) as { messages?: Array<{ id?: string }> };
          const wamid = result.messages?.[0]?.id;
          if (wamid) {
            await persistExternalId(job.data, wamid);
            if (job.data.tenantId) {
              incrementUsage(job.data.tenantId, 'messages_sent').catch((err: unknown) =>
                logger.warn({ err, tenantId: job.data.tenantId }, 'usage: failed to increment messages_sent'),
              );
            }
            logger.info({ jobId: job.id, messageId: job.data.messageId, externalId: wamid }, '[WhatsApp Worker] Message sent');
          } else {
            await persistSentStatus(job.data);
          }
          return result;
        } catch {
          await persistSentStatus(job.data);
          return { ok: true, raw: responseText };
        }
      }

      case 'instagram': {
        const pageId =
          channelCredentials['page_id'] ??
          channelCredentials['pageId'];
        const accessToken =
          channelCredentials['access_token'] ??
          channelCredentials['accessToken'];

        if (!pageId || !accessToken) {
          logger.error({ jobId: job.id }, '[Instagram] Missing credentials');
          await handlePermanentDeliveryFailure(
            job.data,
            { instagram_send_error: 'missing_credentials' },
            'credenciais do Instagram não configuradas',
          );
          return;
        }

        const recipientPsid = job.data.to?.trim();
        if (!recipientPsid) {
          logger.error({ jobId: job.id, messageId: job.data.messageId }, '[Instagram] Missing recipient PSID');
          await handlePermanentDeliveryFailure(
            job.data,
            { instagram_send_error: 'missing_recipient_psid' },
            'destinatário do Instagram ausente',
          );
          return;
        }

        let messagePayload: Record<string, unknown>;
        if (job.data.mediaId && job.data.mediaType) {
          // Instagram uses 'file' for document attachments
          const igType = job.data.mediaType === 'document' ? 'file' : job.data.mediaType;
          messagePayload = {
            recipient: { id: recipientPsid },
            message: {
              attachment: {
                type: igType,
                payload: { url: job.data.mediaId, is_reusable: true },
              },
            },
          };
        } else {
          messagePayload = {
            recipient: { id: recipientPsid },
            message: { text: job.data.content ?? '' },
          };
        }

        const igResponse = await fetch(
          `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${pageId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(messagePayload),
          },
        );
        const igText = await igResponse.text();

        if (!igResponse.ok) {
          let igErrorCode: number | null = null;
          let igErrorMessage: string | null = null;
          try {
            const parsed = JSON.parse(igText) as MetaApiErrorResponse;
            igErrorCode = typeof parsed.error?.code === 'number' ? parsed.error.code : null;
            igErrorMessage = parsed.error?.message?.trim() ?? null;
          } catch { /* not JSON */ }

          // Permanent errors — do not retry
          const permanentCodes = new Set([10, 100, 190, 200, 368]);
          if (igErrorCode !== null && permanentCodes.has(igErrorCode)) {
            logger.error(
              { jobId: job.id, code: igErrorCode },
              '[Instagram] Permanent error — no retry',
            );
            await handlePermanentDeliveryFailure(job.data, {
              instagram_send_http_status: igResponse.status,
              instagram_send_error_code: igErrorCode,
              instagram_send_error_message: igErrorMessage,
              instagram_send_failed_at: new Date().toISOString(),
            }, igErrorMessage ?? `Instagram API error ${igErrorCode}`);
            return;
          }

          throw new Error(`[Instagram] API error: ${igText}`);
        }

        try {
          const igResult = JSON.parse(igText) as { message_id?: string };
          if (igResult.message_id) {
            await persistExternalId(job.data, igResult.message_id);
          } else {
            await persistSentStatus(job.data);
          }
          logger.info(
            { jobId: job.id, messageId: job.data.messageId, igMessageId: igResult.message_id },
            '[Instagram] Message sent',
          );
          return igResult;
        } catch {
          return { ok: true, raw: igText };
        }
      }

      case 'email': {
        const toEmail = job.data.to?.trim();
        if (!toEmail) {
          logger.error({ jobId: job.id, messageId: job.data.messageId }, '[Email] Missing recipient email');
          await handlePermanentDeliveryFailure(
            job.data,
            { email_send_error: 'missing_recipient_email' },
            'destinatário de e-mail ausente',
          );
          return;
        }

        // Fetch conversation subject for email thread
        const emailSchemaName = await resolveSchemaName(job.data);
        let emailSubject = `Re: Atendimento ${job.data.conversationId.slice(0, 8)}`;
        if (emailSchemaName) {
          const convRows = await prisma.$queryRawUnsafe<Array<{ subject: string | null }>>(
            `SELECT subject FROM ${quoteIdent(emailSchemaName)}.conversations WHERE id = $1::uuid LIMIT 1`,
            job.data.conversationId,
          );
          if (convRows[0]?.subject?.trim()) {
            emailSubject = convRows[0].subject.trim();
          }
        }

        if (!emailSchemaName) {
          logger.error({ jobId: job.id, messageId: job.data.messageId }, '[Email] Missing tenant schema');
          await handlePermanentDeliveryFailure(
            job.data,
            { email_send_error: 'missing_tenant_schema' },
            'schema do tenant não resolvido',
          );
          return;
        }

        const textContent = job.data.content ?? '';
        const htmlBody = textContent
          .split('\n')
          .map((line) => `<p>${line}</p>`)
          .join('');
        try {
          await sendEmail({
            tenantId: job.data.tenantId ?? 'unknown',
            tenantSchema: emailSchemaName,
            to: toEmail,
            subject: emailSubject,
            html: htmlBody,
            text: textContent,
          });
          await persistSentStatus(job.data);
          logger.info(
            { jobId: job.id, messageId: job.data.messageId },
            '[Email] Message sent',
          );
          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown_error';

          if (message === 'EMAIL_NOT_CONFIGURED') {
            await handlePermanentDeliveryFailure(job.data, {
              email_send_error: 'email_not_configured',
              email_send_failed_at: new Date().toISOString(),
            }, 'provedor de e-mail não configurado');
            logger.error({ jobId: job.id, messageId: job.data.messageId }, '[Email] Provider not configured');
            return;
          }

          throw error;
        }
      }
    }
  },
  {
    connection: bullmqConnection,
    concurrency: 10,
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, '[WhatsApp Worker] Job failed');
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const reason = err instanceof Error ? err.message : String(err);
  void handlePermanentDeliveryFailure(
    job.data,
    {
      delivery_error: reason.slice(0, 500),
      delivery_failed_at: new Date().toISOString(),
    },
    reason,
  ).catch((error: unknown) => {
    logger.error(
      {
        jobId: job.id,
        messageId: job.data.messageId,
        conversationId: job.data.conversationId,
        error: error instanceof Error ? error.message : String(error),
      },
      '[Message Worker] Failed to persist final delivery failure',
    );
  });
});

worker.on('active', (job) => {
  logger.info({ jobId: job.id }, '[WhatsApp Worker] Processing');
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, '[WhatsApp Worker] Completed');
});

export { worker };

