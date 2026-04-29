import { z } from 'zod';

const categoryEnum = z.enum([
  'greeting',
  'service',
  'commercial',
  'closing',
  'support',
  'other',
]);

export const listQuickRepliesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  category: categoryEnum.optional(),
});

export const createQuickReplySchema = z.object({
  title: z.string().trim().min(1).max(120),
  shortcut: z.string().trim().min(1).max(50).regex(/^[a-z0-9_-]+$/i, 'Atalho inválido'),
  content: z.string().trim().min(1).max(5000),
  category: categoryEnum.default('other'),
});

export const updateQuickReplySchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  shortcut: z.string().trim().min(1).max(50).regex(/^[a-z0-9_-]+$/i, 'Atalho inválido').optional(),
  content: z.string().trim().min(1).max(5000).optional(),
  category: categoryEnum.optional(),
});

export type ListQuickRepliesQuery = z.infer<typeof listQuickRepliesQuerySchema>;
export type CreateQuickReplyInput = z.infer<typeof createQuickReplySchema>;
export type UpdateQuickReplyInput = z.infer<typeof updateQuickReplySchema>;
