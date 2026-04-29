import { z } from 'zod';

export const listConversationsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    perPage: z.coerce.number().int().positive().max(100).optional(),
    per_page: z.coerce.number().int().positive().max(100).optional(),
    status: z.enum(['open', 'in_service', 'pending', 'resolved', 'bot', 'closed']).optional(),
    search: z.string().optional(),
    assigned_to_me: z.coerce.boolean().optional(),
    client_id: z.string().uuid().optional(),
  })
  .transform(({ per_page, perPage, ...query }) => ({
    ...query,
    perPage: perPage ?? per_page ?? 50,
  }));

export const createConversationBodySchema = z.object({
  client_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  subject: z.string().max(255).optional(),
  initial_message: z.string().min(1).max(4000).optional(),
});

export const sendMessageBodySchema = z.object({
  content: z.string().max(4000).optional(),
  contentType: z.enum(['text', 'image', 'audio', 'video', 'document']).default('text'),
  isInternal: z.coerce.boolean().optional(),
  media_id: z.string().optional(),
  media_type: z.enum(['image', 'audio', 'video', 'document']).optional(),
  media_filename: z.string().max(255).optional(),
}).refine((data) => Boolean(data.content?.trim()) || Boolean(data.media_id), {
  message: 'Mensagem deve conter texto ou mídia',
}).refine((data) => !data.media_id || Boolean(data.media_type), {
  message: 'media_type é obrigatório quando media_id for informado',
});

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(50),
  before: z.string().uuid().optional(),
});

export const updateConversationBodySchema = z
  .object({
    status: z.enum(['open', 'in_service', 'pending', 'resolved', 'bot', 'closed']).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
    csat_score: z.number().min(1).max(5).optional(),
    csat_comment: z.string().optional(),
  })
  .refine((data) => data.status !== undefined || data.assignedTo !== undefined || data.csat_score !== undefined || data.csat_comment !== undefined, {
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
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type UpdateConversationBody = z.infer<typeof updateConversationBodySchema>;
export type AssignConversationBody = z.infer<typeof assignConversationBodySchema>;
export type TransferConversationBody = z.infer<typeof transferConversationBodySchema>;
