import type { FastifyInstance } from 'fastify';
import { whatsappWebhookRoutes } from './whatsapp.webhook.js';
import { instagramWebhookRoutes } from './instagram.webhook.js';
import { emailWebhookRoutes } from './email.webhook.js';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  await app.register(whatsappWebhookRoutes);
  await app.register(instagramWebhookRoutes);
  await app.register(emailWebhookRoutes);
}
