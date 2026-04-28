import { z } from 'zod';

export const listConversationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(50),
  status: z.enum(['open', 'in_service', 'pending', 'resolved', 'bot']).optional(),
  search: z.string().optional(),
  assigned_to_me: z.coerce.boolean().optional(),
});

export const createConversationBodySchema = z.object({
  client_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  subject: z.string().max(255).optional(),
  initial_message: z.string().min(1).max(4000).optional(),
});

export const sendMessageBodySchema = z.object({
  content: z.string().min(1).max(4000),
  contentType: z.enum(['text', 'image']).default('text'),
});

export const updateConversationBodySchema = z
  .object({
    status: z.enum(['open', 'in_service', 'pending', 'resolved', 'bot']).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((data) => data.status !== undefined || data.assignedTo !== undefined, {
    message: 'Ao menos um campo deve ser fornecido',
  });

export const assignConversationBodySchema = z.object({
  user_id: z.string().uuid(),
});

export const transferConversationBodySchema = z.object({
  user_id: z.string().uuid(),
  reason: z.string().optional(),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;
export type UpdateConversationBody = z.infer<typeof updateConversationBodySchema>;
export type AssignConversationBody = z.infer<typeof assignConversationBodySchema>;
export type TransferConversationBody = z.infer<typeof transferConversationBodySchema>;
