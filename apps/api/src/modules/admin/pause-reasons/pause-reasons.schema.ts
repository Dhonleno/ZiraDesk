import { z } from 'zod';

export const createPauseReasonSchema = z.object({
  label: z.string().min(1).max(100),
  icon: z.string().min(1).max(10).optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
});

export const updatePauseReasonSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  icon: z.string().min(1).max(10).optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Informe ao menos um campo',
});

export type CreatePauseReasonInput = z.infer<typeof createPauseReasonSchema>;
export type UpdatePauseReasonInput = z.infer<typeof updatePauseReasonSchema>;
