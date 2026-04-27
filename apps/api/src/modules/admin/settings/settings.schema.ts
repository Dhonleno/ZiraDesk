import { z } from 'zod';

export const updateSettingsSchema = z.object({
  name: z.string().min(1).max(100),
  logo_url: z.string().url().optional(),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida (ex: #00C9A7)').optional(),
  timezone: z.string().optional(),
  language: z.enum(['pt-BR', 'en-US', 'es']).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
