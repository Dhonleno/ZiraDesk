import { z } from 'zod';

export const createPlanSchema = z.object({
  name: z.string().min(1).max(50),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  priceMonth: z.number().positive(),
  priceYear: z.number().positive().optional(),
  maxUsers: z.number().int(), // -1 = ilimitado
  maxContacts: z.number().int(), // -1 = ilimitado
  features: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

export const updatePlanSchema = createPlanSchema.partial();

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
