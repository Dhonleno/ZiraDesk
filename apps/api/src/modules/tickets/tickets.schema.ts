import { z } from 'zod';

export const createTicketSchema = z.object({
  contact_id:      z.string().uuid().optional(),
  organization_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  source_conversation_id: z.string().uuid().optional(),
  title:           z.string().min(3).max(255),
  description:     z.string().optional(),
  status:          z.enum(['open', 'in_progress', 'waiting']).default('open'),
  priority:        z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  category:        z.string().max(100).optional(),
  type_id:         z.string().uuid().nullable().optional(),
  assigned_to:     z.string().uuid().nullable().optional(),
  due_date:        z.string().datetime({ offset: true }).optional(),
  tags:            z.array(z.string()).optional(),
});

export const updateTicketSchema = createTicketSchema
  .omit({ status: true })
  .partial()
  .extend({
    status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).optional(),
  });

export const listTicketsQuerySchema = z.object({
  page:        z.coerce.number().int().positive().default(1),
  per_page:    z.coerce.number().int().positive().max(100).default(20),
  search:      z.string().optional(),
  status:      z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).optional(),
  priority:    z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigned_to: z.string().uuid().optional(),
  source:      z.enum(['manual', 'portal', 'email', 'whatsapp', 'api']).optional(),
  contact_id:      z.string().uuid().optional(),
  organization_id: z.string().uuid().optional(),
  category:    z.string().optional(),
  sort_by:     z.enum(['created_at', 'updated_at', 'priority', 'due_date']).default('created_at'),
  sort_order:  z.enum(['asc', 'desc']).default('desc'),
});

export const exportTicketsQuerySchema = z.object({
  format: z.enum(['csv']).default('csv'),
  search: z.string().optional(),
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigned_to: z.string().uuid().optional(),
  source: z.enum(['manual', 'portal', 'email', 'whatsapp', 'api']).optional(),
  contact_id: z.string().uuid().optional(),
  organization_id: z.string().uuid().optional(),
  category: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

export const createCommentSchema = z.object({
  content:     z.string().min(1),
  is_internal: z.boolean().default(false),
});

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1),
});

export const assignTicketSchema = z.object({
  user_id: z.string().uuid(),
});

export const createChecklistItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const updateChecklistItemSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  is_done: z.boolean().optional(),
}).refine((data) => data.title !== undefined || data.is_done !== undefined, {
  message: 'Informe ao menos um campo para atualização',
});

export const createTimeEntrySchema = z.object({
  minutes: z.number().int().positive(),
  description: z.string().trim().max(300).optional(),
  worked_at: z.string().date().optional(),
});

export type CreateTicketInput  = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput  = z.infer<typeof updateTicketSchema>;
export type ListTicketsQuery   = z.infer<typeof listTicketsQuerySchema>;
export type ExportTicketsQuery = z.infer<typeof exportTicketsQuerySchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type AssignTicketInput  = z.infer<typeof assignTicketSchema>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
