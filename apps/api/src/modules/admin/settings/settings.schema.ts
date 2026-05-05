import { z } from 'zod';

export const updateSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  logo_url: z.string().url().nullable().optional(),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida (ex: #00C9A7)').optional(),
  timezone: z.string().optional(),
  language: z.enum(['pt-BR', 'en-US', 'es']).optional(),
  away_message: z.string().max(1000).optional(),
  away_message_enabled: z.boolean().optional(),
  csat_enabled: z.boolean().optional(),
  csat_message: z.string().max(2000).optional(),
  email_confirmation: z.boolean().optional(),
  inactivity_enabled: z.boolean().optional(),
  inactivity_warning_minutes: z.number().int().min(1).max(1440).optional(),
  inactivity_close_minutes: z.number().int().min(1).max(1440).optional(),
  inactivity_warning_message: z.string().max(2000).optional(),
  inactivity_close_message: z.string().max(2000).optional(),
  bot_assigned_message: z.string().max(1000).optional(),
}).superRefine((data, ctx) => {
  if (
    data.inactivity_warning_minutes !== undefined
    && data.inactivity_close_minutes !== undefined
    && data.inactivity_close_minutes <= data.inactivity_warning_minutes
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['inactivity_close_minutes'],
      message: 'O tempo de encerramento deve ser maior que o tempo de aviso',
    });
  }
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
