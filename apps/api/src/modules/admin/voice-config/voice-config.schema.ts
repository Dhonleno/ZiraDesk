import { z } from 'zod';

export const updateVoiceConfigSchema = z.object({
  twilioPhoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Formato E.164 inválido'),
  defaultBotMenuId: z.string().uuid().nullable().optional(),
  ivrEnabled: z.boolean().optional(),
  ringTimeoutSeconds: z.number().int().min(5).max(60).optional(),
});

export type UpdateVoiceConfigInput = z.infer<typeof updateVoiceConfigSchema>;
