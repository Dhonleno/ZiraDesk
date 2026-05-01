import { z } from 'zod';

const colorRegex = /^#[0-9a-fA-F]{6}$/;

export const createSkillSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional().nullable(),
  tag: z.string().max(50).optional().nullable(),
  color: z.string().regex(colorRegex).optional(),
});

export const updateSkillSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  tag: z.string().max(50).optional().nullable(),
  color: z.string().regex(colorRegex).optional(),
  is_active: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Ao menos um campo deve ser informado',
});

export const assignSkillSchema = z.object({
  skill_id: z.string().uuid(),
  level: z.enum(['junior', 'intermediate', 'senior']).default('intermediate'),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type AssignSkillInput = z.infer<typeof assignSkillSchema>;
