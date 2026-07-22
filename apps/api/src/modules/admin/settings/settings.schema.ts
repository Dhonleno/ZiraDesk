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
  csat_expiration_hours: z.number().int().min(1, 'Mínimo 1 hora').max(720, 'Máximo 30 dias').optional(),
  email_confirmation: z.boolean().optional(),
  inactivity_enabled: z.boolean().optional(),
  inactivity_warning_minutes: z.number().int().min(1).max(1440).optional(),
  inactivity_close_minutes: z.number().int().min(1).max(1440).optional(),
  inactivity_warning_message: z.string().max(2000).optional(),
  inactivity_close_message: z.string().max(2000).optional(),
  active_outbound_validity_mode: z.enum(['end_of_day', 'hours', 'unlimited']).optional(),
  active_outbound_validity_hours: z.number().int().min(1).max(168).optional(),
  bot_assigned_message: z.string().max(1000).optional(),
  max_conversations_per_agent: z.number().int().min(1).max(500).nullable().optional(),
  routing_skill_timeout_ms: z.number().int().min(30_000).max(600_000).default(120_000).optional(),
  lgpd_retention_enabled: z.boolean().optional(),
  lgpd_retention_days: z.number().int().min(1).max(3650).optional(),
  queue_notifications_enabled: z.boolean().optional(),
  queue_message_template: z.string().max(1000).optional(),
  queue_throttle_seconds: z.number().int().min(30).max(600).optional(),
  agent_assume_template: z.string().max(1000).optional(),
  expire_24h_action: z.enum(['close', 'keep_open']).optional(),
  expire_24h_message: z.string().max(1000).optional(),
  ticket_auto_assign: z.boolean().optional(),
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
