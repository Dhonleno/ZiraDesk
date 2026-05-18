import { z } from 'zod';

const booleanQueryParamSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  return value;
}, z.boolean());

export const listConversationsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    perPage: z.coerce.number().int().positive().max(100).optional(),
    per_page: z.coerce.number().int().positive().max(100).optional(),
    tab: z.enum(['active', 'queue', 'return', 'active_outbound', 'closed']).optional(),
    sub_status: z.enum(['resolved', 'closed', 'outbound']).optional(),
    status: z.enum(['open', 'active_outbound', 'in_service', 'pending', 'resolved', 'bot', 'closed']).optional(),
    search: z.string().optional(),
    assigned_to_me: booleanQueryParamSchema.optional(),
    agent_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    organization_id: z.string().uuid().optional(),
    tag_id: z.string().uuid().optional(),
  })
  .transform(({ per_page, perPage, ...query }) => ({
    ...query,
    perPage: perPage ?? per_page ?? 50,
  }));

export const createConversationBodySchema = z
  .object({
    contact_id: z.string().uuid(),
    organization_id: z.string().uuid().optional(),
    channel_id: z.string().uuid(),
    type: z.enum(['inbound', 'outbound']).default('inbound'),
    subject: z.string().max(255).optional(),
    initial_message: z.string().max(4000).optional(),
    initial_template: z.object({
      name: z.string().trim().min(1).max(512),
      language: z.string().trim().min(2).max(20).default('pt_BR'),
      components: z.array(z.record(z.unknown())).optional(),
    }).optional(),
  })
  .refine((data) => (
    data.type !== 'outbound'
      || Boolean(data.initial_message?.trim())
      || Boolean(data.initial_template?.name?.trim())
  ), {
    path: ['initial_message'],
    message: 'Mensagem inicial ou template é obrigatório para atendimento ativo',
  });

export const sendMessageBodySchema = z.object({
  content: z.string().max(4000).optional(),
  contentType: z.enum(['text', 'image', 'audio', 'video', 'document', 'template']).default('text'),
  isInternal: z.coerce.boolean().optional(),
  media_id: z.string().optional(),
  media_type: z.enum(['image', 'audio', 'video', 'document']).optional(),
  media_filename: z.string().max(255).optional(),
  mention_message_id: z.string().uuid().optional(),
  whatsapp_template: z.object({
    name: z.string().trim().min(1).max(512),
    language: z.string().trim().min(2).max(20).default('pt_BR'),
    components: z.array(z.record(z.unknown())).optional(),
  }).optional(),
}).refine((data) => {
  if (data.contentType === 'template') {
    return Boolean(data.whatsapp_template?.name?.trim());
  }

  return Boolean(data.content?.trim()) || Boolean(data.media_id);
}, {
  message: 'Mensagem deve conter texto, mídia ou template',
}).refine((data) => !data.media_id || Boolean(data.media_type), {
  message: 'media_type é obrigatório quando media_id for informado',
}).refine((data) => data.contentType === 'template' || !data.whatsapp_template, {
  message: 'whatsapp_template só pode ser enviado quando contentType = template',
}).refine((data) => data.contentType !== 'template' || !data.media_id, {
  message: 'Template não pode ser enviado junto com mídia',
});

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(50),
  before: z.string().uuid().optional(),
});

export const updateConversationBodySchema = z
  .object({
    status: z.enum(['open', 'active_outbound', 'in_service', 'pending', 'resolved', 'bot', 'closed']).optional(),
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

export const transferConversationBodySchema = z
  .object({
    user_id: z.string().uuid().optional(),
    skill_id: z.string().uuid().optional(),
    reason: z.string().optional(),
  })
  .refine(
    (data) => Boolean(data.user_id) !== Boolean(data.skill_id),
    { message: 'Forneça user_id OU skill_id (não ambos, não nenhum)' },
  );

export const requestHelpBodySchema = z.object({
  helper_user_id: z.string().uuid(),
});

export const availabilityBodySchema = z.object({
  is_available: z.boolean(),
});

export const resolveConversationBodySchema = z.object({
  closeTypeId: z.string().cuid(),
  closeOutcomeId: z.string().cuid(),
  csatMode: z.enum(['resolve', 'close']),
  internalNote: z.string().trim().max(4000).optional(),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type UpdateConversationBody = z.infer<typeof updateConversationBodySchema>;
export type AssignConversationBody = z.infer<typeof assignConversationBodySchema>;
export type TransferConversationBody = z.infer<typeof transferConversationBodySchema>;
export type RequestHelpBody = z.infer<typeof requestHelpBodySchema>;
export type AvailabilityBody = z.infer<typeof availabilityBodySchema>;
export type ResolveConversationBody = z.infer<typeof resolveConversationBodySchema>;
