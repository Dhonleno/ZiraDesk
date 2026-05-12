import { z } from 'zod';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

const dayShiftSchema = z.object({
  openTime: timeSchema,
  closeTime: timeSchema,
});

const businessHourDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isActive: z.boolean(),
  shifts: z.array(dayShiftSchema),
});

const holidayAddSchema = z
  .object({
    date: dateSchema,
    name: z.string().trim().min(1).max(120),
    behavior: z.enum(['closed', 'custom_hours']),
    openTime: timeSchema.optional(),
    closeTime: timeSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.behavior !== 'custom_hours') return;
    if (!data.openTime || !data.closeTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe openTime e closeTime para behavior=custom_hours',
      });
    }
  });

const holidayPatchSchema = z.object({
  add: z.array(holidayAddSchema).optional(),
  remove: z.array(z.string().uuid()).optional(),
});

export const updateBusinessHoursSchema = z
  .object({
    is24x7: z.boolean().optional(),
    days: z.array(businessHourDaySchema).optional(),
    holidays: holidayPatchSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo');

export const importNationalHolidaysSchema = z.object({
  country: z.enum(['BR', 'US', 'PT', 'AR']),
});

export type UpdateBusinessHoursInput = z.infer<typeof updateBusinessHoursSchema>;
export type ImportNationalHolidaysInput = z.infer<typeof importNationalHolidaysSchema>;
