import { z } from 'zod';

export const assignSkillSchema = z.object({
  bot_option_id: z.string().uuid(),
  level: z.enum(['junior', 'intermediate', 'senior']).default('intermediate').optional(),
});

export type AssignSkillInput = z.infer<typeof assignSkillSchema>;
