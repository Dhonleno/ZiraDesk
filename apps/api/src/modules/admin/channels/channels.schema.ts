import { z } from 'zod';

export const createChannelSchema = z.object({
  type: z.enum(['whatsapp', 'instagram', 'email', 'webchat']),
  name: z.string().min(1).max(100),
  credentials: z.record(z.unknown()),
  settings: z.record(z.unknown()).optional(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  credentials: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
