import { z } from 'zod';

export const createBotOptionSchema = z.object({
  number: z.coerce.number().int().min(0),
  label: z.string().min(1).max(100),
  tag: z.string().max(50).optional().nullable(),
  response: z.string().min(1),
  sort_order: z.coerce.number().int().default(0),
});

export const updateBotMenuSchema = z
  .object({
    is_active: z.boolean().optional(),
    greeting: z.string().optional(),
    footer: z.string().optional(),
    invalid_msg: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo');

export const updateBotOptionSchema = createBotOptionSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  'Informe ao menos um campo',
);

export const reorderBotOptionsSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export type CreateBotOptionInput = z.infer<typeof createBotOptionSchema>;
export type UpdateBotMenuInput = z.infer<typeof updateBotMenuSchema>;
export type UpdateBotOptionInput = z.infer<typeof updateBotOptionSchema>;
