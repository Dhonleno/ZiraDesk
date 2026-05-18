import { z } from 'zod';

export const redmineCreateSchema = z.object({
  name: z.string().min(1).max(100).default('Redmine'),
  redmineUrl: z.string().url(),
  apiKey: z.string().min(1),
  projectId: z.string().min(1).max(100),
  isActive: z.boolean().optional(),
  syncComments: z.boolean().optional(),
  syncStatus: z.boolean().optional(),
  statusMap: z.record(z.union([z.number(), z.string()])).optional(),
});

export const redmineUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  redmineUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  projectId: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  syncComments: z.boolean().optional(),
  syncStatus: z.boolean().optional(),
  statusMap: z.record(z.union([z.number(), z.string()])).optional(),
});

export const redmineTestSchema = z.object({
  redmineUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
});

export type RedmineCreateInput = z.infer<typeof redmineCreateSchema>;
export type RedmineUpdateInput = z.infer<typeof redmineUpdateSchema>;
export type RedmineTestInput = z.infer<typeof redmineTestSchema>;
