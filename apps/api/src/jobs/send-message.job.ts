import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

interface SendMessageJob {
  messageId: string;
  conversationId: string;
  channelType: 'whatsapp' | 'instagram' | 'email';
  channelCredentials: Record<string, string>;
  content: string;
  to: string;
  mediaId?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
}

function buildWhatsAppBody(job: SendMessageJob, sanitizedPhone: string) {
  if (!job.mediaId || !job.mediaType) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sanitizedPhone,
      type: 'text',
      text: { body: job.content },
    };
  }

  const mediaTypeRaw = (job.mediaType ?? '').toLowerCase();
  const mediaGroup = mediaTypeRaw.includes('/') ? mediaTypeRaw.split('/')[0] : mediaTypeRaw;
  const isDocumentByType = mediaTypeRaw === 'document' || mediaGroup === 'application' || mediaGroup === 'text';
  const caption = job.content?.trim() || undefined;
  switch (mediaGroup) {
    case 'image':
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'image',
        image: { id: job.mediaId, ...(caption ? { caption } : {}) },
      };
    case 'audio':
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'audio',
        audio: { id: job.mediaId },
      };
    case 'video':
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'video',
        video: { id: job.mediaId, ...(caption ? { caption } : {}) },
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
        };
      }
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'text',
        text: { body: job.content },
      };
  }
}

const worker = new Worker<SendMessageJob>(
  'ziradesk-messages',
  async (job) => {
    const { channelType, channelCredentials, to } = job.data;

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
        const sanitizedPhone = to.replace(/\D/g, '');
        const body = buildWhatsAppBody(job.data, sanitizedPhone);

        console.log('[WhatsApp Send] Job data:', JSON.stringify(job.data, null, 2));
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
          throw new Error(`Meta API error: ${responseText}`);
        }

        try {
          return JSON.parse(responseText);
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
  console.error(`[MessageQueue] Job ${job?.id} failed:`, err.message);
});

export { worker };
