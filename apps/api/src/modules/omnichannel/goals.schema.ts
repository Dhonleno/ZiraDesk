import { z } from 'zod';

function toNullableString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableNumber(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

const nullableUuid = z.preprocess(toNullableString, z.union([z.string().uuid(), z.null()]));
const nullablePositiveInt = z.preprocess(toNullableNumber, z.union([z.number().int().min(1), z.null()]));
const nullablePercentInt = z.preprocess(toNullableNumber, z.union([z.number().int().min(0).max(100), z.null()]));
const nullableCsat = z.preprocess(toNullableNumber, z.union([z.number().min(1).max(5), z.null()]));

const goalBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(['global', 'agent']),
  agentId: nullableUuid.optional(),
  period: z.enum(['daily', 'weekly', 'monthly']),
  goalTmaMinutes: nullablePositiveInt.optional(),
  goalTmeMinutes: nullablePositiveInt.optional(),
  goalSlaPercent: nullablePercentInt.optional(),
  goalCsatMin: nullableCsat.optional(),
  goalVolumeMin: nullablePositiveInt.optional(),
  isActive: z.boolean().default(true),
});

export const createGoalSchema = goalBaseSchema.superRefine((value, ctx) => {
  if (value.scope === 'agent' && !value.agentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'agentId é obrigatório quando scope = agent',
      path: ['agentId'],
    });
  }
});

export const updateGoalSchema = goalBaseSchema.partial();

export const goalParamsSchema = z.object({
  id: z.string().uuid(),
});

export const goalsQuerySchema = z.object({
  include_inactive: z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  }, z.boolean().default(false)),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
