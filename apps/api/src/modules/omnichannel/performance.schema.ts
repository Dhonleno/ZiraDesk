import { z } from 'zod';

const numberParam = (defaultValue: number, min: number, max: number) => z.preprocess((value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return defaultValue;
}, z.number().int().min(min).max(max));

export const performanceQuerySchema = z.object({
  period: z.enum(['today', 'yesterday', '7d', '30d', 'month', 'custom']).optional().default('7d'),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  agent_id: z.string().uuid().optional(),
  bot_option_id: z.string().uuid().optional(),
  export: z.enum(['csv']).optional(),
  page: numberParam(1, 1, 100000).optional().default(1),
  per_page: numberParam(25, 1, 200).optional().default(25),
});

export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;
