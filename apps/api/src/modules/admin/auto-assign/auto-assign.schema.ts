import { z } from 'zod';

export const updateAutoAssignConfigSchema = z
  .object({
    auto_assign: z.boolean().optional(),
    auto_assign_algorithm: z.enum(['round_robin']).optional(),
  })
  .refine((data) => data.auto_assign !== undefined || data.auto_assign_algorithm !== undefined, {
    message: 'Ao menos um campo deve ser fornecido',
  });

export const toggleAgentAvailabilitySchema = z.object({
  is_available: z.boolean(),
});

export type UpdateAutoAssignConfigInput = z.infer<typeof updateAutoAssignConfigSchema>;
export type ToggleAgentAvailabilityInput = z.infer<typeof toggleAgentAvailabilitySchema>;
