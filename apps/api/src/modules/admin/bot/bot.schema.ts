import { z } from 'zod';

const botOptionBaseSchema = z.object({
  number: z.coerce.number().int().min(0),
  label: z.string().min(1).max(100),
  tag: z.string().max(50).optional().nullable(),
  response: z.string().optional().nullable(),
  has_submenu: z.boolean().default(false),
  submenu_greeting: z.string().optional().nullable(),
  parent_option_id: z.string().uuid().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});

export const createBotOptionSchema = botOptionBaseSchema.refine((data) => data.has_submenu || Boolean(data.response?.trim()), {
  path: ['response'],
  message: 'Resposta é obrigatória para opções sem submenu',
});

export const createBotSubOptionSchema = botOptionBaseSchema.omit({
  parent_option_id: true,
}).refine((data) => data.has_submenu || Boolean(data.response?.trim()), {
  path: ['response'],
  message: 'Resposta é obrigatória para opções sem submenu',
});

export const updateBotMenuSchema = z
  .object({
    is_active: z.boolean().optional(),
    greeting: z.string().optional(),
    footer: z.string().optional(),
    invalid_msg: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo');

export const updateBotOptionSchema = botOptionBaseSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  'Informe ao menos um campo',
);

export const reorderBotOptionsSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export type CreateBotOptionInput = z.infer<typeof createBotOptionSchema>;
export type CreateBotSubOptionInput = z.infer<typeof createBotSubOptionSchema>;
export type UpdateBotMenuInput = z.infer<typeof updateBotMenuSchema>;
export type UpdateBotOptionInput = z.infer<typeof updateBotOptionSchema>;
