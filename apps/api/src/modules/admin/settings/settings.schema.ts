import { z } from 'zod';

export const updateSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  logo_url: z.string().url().optional(),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida (ex: #00C9A7)').optional(),
  timezone: z.string().optional(),
  language: z.enum(['pt-BR', 'en-US', 'es']).optional(),
  away_message: z.string().max(1000).optional(),
  away_message_enabled: z.boolean().optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
