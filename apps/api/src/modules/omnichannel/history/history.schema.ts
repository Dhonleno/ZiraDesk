import { z } from 'zod';

const numberParam = (defaultValue: number, min: number, max: number) => z.preprocess((value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return defaultValue;
}, z.number().int().min(min).max(max));

export const historyQuerySchema = z.object({
  page: numberParam(1, 1, 100000).optional().default(1),
  per_page: numberParam(25, 1, 200).optional().default(25),
  search: z.string().trim().min(1).max(120).optional(),
  status: z.string().trim().min(1).max(30).optional(),
  assigned_to: z.string().uuid().optional(),
  channel_type: z.string().trim().min(1).max(30).optional(),
  bot_option_id: z.string().uuid().optional(),
  csat_rating: z.enum(['1', '2', '3', '4', '5', 'none']).optional(),
  period: z.enum(['today', 'yesterday', '7d', '30d', 'month', 'custom']).optional().default('7d'),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  export: z.enum(['csv']).optional(),
  sort_by: z.enum([
    'created_at',
    'protocol_number',
    'contact_name',
    'assigned_name',
    'channel_type',
    'status',
    'duration_seconds',
    'wait_seconds',
    'csat_score',
  ]).optional().default('created_at'),
  sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const historyDetailParamsSchema = z.object({
  conversationId: z.string().uuid(),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
