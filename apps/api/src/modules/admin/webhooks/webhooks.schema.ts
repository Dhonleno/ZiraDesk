import { z } from 'zod';

export const SUPPORTED_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.resolved',
  'ticket.closed',
  'conversation.created',
  'conversation.resolved',
  'conversation.assigned',
  'contact.created',
  'contact.updated',
] as const;

export type WebhookEvent = (typeof SUPPORTED_EVENTS)[number];

export const createWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
  headers: z.record(z.string()).optional(),
  isActive: z.boolean().default(true),
});

export const updateWebhookSchema = createWebhookSchema.partial();

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
