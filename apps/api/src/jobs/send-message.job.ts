import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';

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

function normalizeWhatsappText(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n');
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sanitizeCredentials(credentials: Record<string, string>): Record<string, string> {
  const hidden = '***';
  return {
    ...credentials,
    ...(credentials.accessToken ? { accessToken: hidden } : {}),
    ...(credentials.access_token ? { access_token: hidden } : {}),
    ...(credentials.verifyToken ? { verifyToken: hidden } : {}),
    ...(credentials.verify_token ? { verify_token: hidden } : {}),
  };
}

function sanitizeJobData(job: SendMessageJob): Record<string, unknown> {
  return {
    ...job,
    channelCredentials: sanitizeCredentials(job.channelCredentials),
  };
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
    console.warn('[WhatsApp Worker] Could not resolve tenant schema to persist external_id', {
      tenantId: job.tenantId,
      messageId: job.messageId,
      externalId,
    });
    return;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${quoteIdent(schemaName)}.messages
     SET external_id = $1, status = 'sent'
     WHERE id = $2::uuid`,
    externalId,
    job.messageId,
  );
}

async function persistFailedStatus(
  job: SendMessageJob,
  metadataPatch: Record<string, unknown>,
): Promise<void> {
  const schemaName = await resolveSchemaName(job);
  if (!schemaName) {
    console.warn('[WhatsApp Worker] Could not resolve tenant schema to persist failed status', {
      tenantId: job.tenantId,
      messageId: job.messageId,
    });
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

  if (templateName) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sanitizedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: {
          policy: 'deterministic',
          code: templateLanguage,
        },
        ...(templateComponents.length ? { components: templateComponents } : {}),
      },
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
    console.log('[WhatsApp Worker] Executing job:', job.id);
    console.log('[WhatsApp Worker] Job data:', JSON.stringify(sanitizeJobData(job.data)));

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
          throw new Error('WhatsApp credentials not configured for sender channel');
        }
        // Meta Cloud API requires digits only: no +, spaces, hyphens or parentheses
        const sanitizedPhone = (job.data.to ?? '').replace(/\D/g, '');
        const replyExternalId = await resolveReplyExternalId(job.data);
        const body = buildWhatsAppBody(job.data, sanitizedPhone, replyExternalId);

        console.log('[WhatsApp Send] Job data:', JSON.stringify(sanitizeJobData(job.data), null, 2));
        console.log('[WhatsApp Send] PhoneNumberId:', phoneNumberId);
        console.log('[WhatsApp Send] Sending to:', sanitizedPhone);
        console.log('[WhatsApp Send] Payload:', JSON.stringify(body, null, 2));

        const response = await fetch(
          `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          },
        );
        const responseText = await response.text();
        console.log('[WhatsApp Send] Response:', responseText);

        if (!response.ok) {
          let metaErrorCode: number | null = null;
          let metaErrorMessage: string | null = null;
          let metaErrorDetails: string | null = null;

          try {
            const parsed = JSON.parse(responseText) as MetaApiErrorResponse;
            metaErrorCode = typeof parsed.error?.code === 'number' ? parsed.error.code : null;
            metaErrorMessage = parsed.error?.message?.trim() ?? null;
            metaErrorDetails = parsed.error?.error_data?.details?.trim() ?? null;
          } catch {
            // Keep fallbacks as null when Meta payload isn't JSON.
          }

          await persistFailedStatus(job.data, {
            whatsapp_send_http_status: response.status,
            whatsapp_send_error_code: metaErrorCode,
            whatsapp_send_error_message: metaErrorMessage,
            whatsapp_send_error_details: metaErrorDetails,
            whatsapp_send_failed_at: new Date().toISOString(),
          });
          throw new Error(`Meta API error: ${responseText}`);
        }

        try {
          const result = JSON.parse(responseText) as { messages?: Array<{ id?: string }> };
          const wamid = result.messages?.[0]?.id;
          if (wamid) {
            await persistExternalId(job.data, wamid);
            console.log('[WhatsApp Worker] external_id persisted:', {
              messageId: job.data.messageId,
              externalId: wamid,
            });
          }
          return result;
        } catch {
          return { ok: true, raw: responseText };
        }
      }

      case 'instagram':
        console.log('[Instagram] send not implemented yet');
        break;

      case 'email':
        console.log('[Email] send not implemented yet');
        break;
    }
  },
  { connection: redis },
);

worker.on('failed', (job, err) => {
  console.error(`[WhatsApp Worker] Job ${job?.id} FAILED:`, err);
  if (job?.data) {
    console.error('[WhatsApp Worker] Job data was:', sanitizeJobData(job.data));
  }
});

worker.on('active', (job) => {
  console.log(`[WhatsApp Worker] Processing job ${job.id}:`, job.data);
});

worker.on('completed', (job) => {
  console.log(`[WhatsApp Worker] Job ${job.id} completed successfully`);
});

export { worker };
