import { z } from 'zod';

export const listConversationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(50),
  status: z.enum(['open', 'in_service', 'resolved']).optional(),
  search: z.string().optional(),
});

export const sendMessageBodySchema = z.object({
  content: z.string().min(1).max(4000),
  contentType: z.enum(['text', 'image']).default('text'),
});

export const updateConversationBodySchema = z
  .object({
    status: z.enum(['open', 'in_service', 'resolved']).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((data) => data.status !== undefined || data.assignedTo !== undefined, {
    message: 'Ao menos um campo deve ser fornecido',
  });

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;
export type UpdateConversationBody = z.infer<typeof updateConversationBodySchema>;
