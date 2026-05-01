import { z } from 'zod';

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida'),
  sort_order: z.coerce.number().int().default(0),
});

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida').optional(),
  sort_order: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Informe ao menos um campo',
});

export const addConversationTagSchema = z.object({
  tag_id: z.string().uuid(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type AddConversationTagInput = z.infer<typeof addConversationTagSchema>;
