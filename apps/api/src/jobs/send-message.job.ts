import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';

interface SendMessageJob {
  messageId: string;
  conversationId: string;
  channelType: 'whatsapp' | 'instagram' | 'email';
  channelCredentials: Record<string, string>;
  content: string;
  to: string;
}

const worker = new Worker<SendMessageJob>(
  'ziradesk-messages',
  async (job) => {
    const { channelType, channelCredentials, content, to } = job.data;

    switch (channelType) {
      case 'whatsapp': {
        const phoneNumberId = channelCredentials['phoneNumberId'];
        const accessToken = channelCredentials['accessToken'];
        // Meta Cloud API requires digits only: no +, spaces, hyphens or parentheses
        const sanitizedPhone = to.replace(/\D/g, '');

        console.log('[WhatsApp Send] PhoneNumberId:', phoneNumberId);
        console.log('[WhatsApp Send] Sending to:', sanitizedPhone);
        console.log('[WhatsApp Send] Content:', content);

        const response = await fetch(
          `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: sanitizedPhone,
              type: 'text',
              text: { body: content },
            }),
          },
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(`Meta API error: ${JSON.stringify(error)}`);
        }

        const result = await response.json();
        return result;
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
