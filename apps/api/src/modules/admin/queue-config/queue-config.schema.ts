import { z } from 'zod';

export const updateQueueConfigSchema = z.object({
  queue_notifications_enabled: z.boolean().optional(),
  queue_message_template: z.string().max(1000).optional(),
  queue_throttle_seconds: z.number().int().min(30).max(600).optional(),
  agent_assume_template: z.string().max(1000).optional(),
  expire_24h_action: z.enum(['close', 'keep_open']).optional(),
  expire_24h_message: z.string().max(1000).optional(),
});

export type UpdateQueueConfigInput = z.infer<typeof updateQueueConfigSchema>;
