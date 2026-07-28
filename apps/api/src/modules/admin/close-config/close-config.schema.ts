import { z } from 'zod';

const closeTypeLabelSchema = z.string().trim().min(1).max(120);
const closeOutcomeLabelSchema = z.string().trim().min(1).max(160);
const orderSchema = z.coerce.number().int().min(0);

export const createCloseTypeSchema = z.object({
  label: closeTypeLabelSchema,
  isActive: z.boolean().optional(),
  order: orderSchema.optional(),
});

export const updateCloseTypeSchema = z.object({
  label: closeTypeLabelSchema.optional(),
  isActive: z.boolean().optional(),
  order: orderSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Informe ao menos um campo',
});

export const createCloseOutcomeSchema = z.object({
  label: closeOutcomeLabelSchema,
  isActive: z.boolean().optional(),
  order: orderSchema.optional(),
});

export const updateCloseOutcomeSchema = z.object({
  label: closeOutcomeLabelSchema.optional(),
  isActive: z.boolean().optional(),
  order: orderSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Informe ao menos um campo',
});

const cuidSchema = z.string().cuid();

/**
 * Aceita o formato dos IDs gerados para registros do admin (cuid) e o dos
 * registros de sistema (prefixo `sys_`). Aceitar o formato nao autoriza a
 * acao: reordenar registro de sistema segue barrado com 409 no service
 * (assertNotSystemRecord).
 */
const closeConfigReorderIdSchema = z.string().refine(
  (id) => id.startsWith('sys_') || cuidSchema.safeParse(id).success,
  { message: 'ID inválido' },
);

export const reorderCloseConfigSchema = z.object({
  ids: z.array(closeConfigReorderIdSchema).min(1),
}).refine((data) => new Set(data.ids).size === data.ids.length, {
  message: 'IDs duplicados não são permitidos',
});

export type CreateCloseTypeInput = z.infer<typeof createCloseTypeSchema>;
export type UpdateCloseTypeInput = z.infer<typeof updateCloseTypeSchema>;
export type CreateCloseOutcomeInput = z.infer<typeof createCloseOutcomeSchema>;
export type UpdateCloseOutcomeInput = z.infer<typeof updateCloseOutcomeSchema>;
export type ReorderCloseConfigInput = z.infer<typeof reorderCloseConfigSchema>;
