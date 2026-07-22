import { z } from 'zod';

const optionalBooleanQuery = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}, z.boolean().optional());

export const listSkillsQuerySchema = z.object({
  is_active: optionalBooleanQuery,
});

export const createSkillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  is_active: z.boolean().default(true),
});

export const updateSkillSchema = createSkillSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  'Informe ao menos um campo',
);

export const assignAgentSkillSchema = z.object({
  skill_id: z.string().uuid(),
  level: z.enum(['junior', 'intermediate', 'senior']).default('intermediate'),
});

export const assignBotOptionSkillSchema = z.object({
  skill_id: z.string().uuid(),
  required: z.boolean().default(true),
});

export type ListSkillsQueryInput = z.infer<typeof listSkillsQuerySchema>;
export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type AssignAgentSkillInput = z.infer<typeof assignAgentSkillSchema>;
export type AssignBotOptionSkillInput = z.infer<typeof assignBotOptionSkillSchema>;
