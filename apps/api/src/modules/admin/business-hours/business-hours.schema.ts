import { z } from 'zod';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido');

export const businessHourDayParamSchema = z.object({
  day: z.coerce.number().int().min(0).max(6),
});

export const updateBusinessHourSchema = z
  .object({
    is_active: z.boolean().optional(),
    open_time: timeSchema.optional(),
    close_time: timeSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo');

export type UpdateBusinessHourInput = z.infer<typeof updateBusinessHourSchema>;
