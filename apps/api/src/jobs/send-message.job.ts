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
      case 'whatsapp':
        await fetch(
          `${channelCredentials['apiUrl']}/message/sendText/${channelCredentials['instance']}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: channelCredentials['apiKey'] ?? '',
            },
            body: JSON.stringify({ number: to, text: content }),
          },
        );
        break;

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
