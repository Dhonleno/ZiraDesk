import { z } from 'zod';

export const createContactTagSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida'),
  sort_order: z.number().int().min(0).optional().default(0),
});

export const updateContactTagSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida').optional(),
  sort_order: z.number().int().min(0).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Informe ao menos um campo',
});

export type CreateContactTagInput = z.infer<typeof createContactTagSchema>;
export type UpdateContactTagInput = z.infer<typeof updateContactTagSchema>;
