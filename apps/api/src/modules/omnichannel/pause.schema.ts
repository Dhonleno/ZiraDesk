import { z } from 'zod';

export const startPauseSchema = z.object({
  reason: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(500).optional(),
});

export type StartPauseInput = z.infer<typeof startPauseSchema>;
