import { z } from 'zod';

const optionSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.string().min(1).max(100),
});

export const createCustomFieldSchema = z.object({
  name:       z.string().trim().min(1).max(100),
  field_key:  z.string().trim().min(1).max(50)
              .regex(/^[a-z][a-z0-9_]*$/, 'Apenas letras minúsculas, números e _ (começando por letra)'),
  field_type: z.enum(['text', 'number', 'date', 'boolean', 'select']),
  options:    z.array(optionSchema).default([]),
  required:          z.boolean().default(false),
  visible_in_portal: z.boolean().default(false),
  sort_order:        z.coerce.number().int().min(0).default(0),
});

// field_key e field_type são imutáveis após criação — não fazem parte do update.
export const updateCustomFieldSchema = z.object({
  name:       z.string().trim().min(1).max(100).optional(),
  options:    z.array(optionSchema).optional(),
  required:          z.boolean().optional(),
  visible_in_portal: z.boolean().optional(),
  sort_order:        z.coerce.number().int().min(0).optional(),
  is_active:         z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Informe ao menos um campo',
});

export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;
