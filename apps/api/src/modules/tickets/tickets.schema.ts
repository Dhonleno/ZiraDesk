import { z } from 'zod';

export const createTicketSchema = z.object({
  contact_id:      z.string().uuid().optional(),
  organization_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  title:           z.string().min(3).max(255),
  description:     z.string().optional(),
  status:          z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).default('open'),
  priority:        z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  category:        z.string().max(100).optional(),
  assigned_to:     z.string().uuid().optional(),
  due_date:        z.string().datetime({ offset: true }).optional(),
  tags:            z.array(z.string()).optional(),
});

export const updateTicketSchema = createTicketSchema.partial();

export const listTicketsQuerySchema = z.object({
  page:        z.coerce.number().int().positive().default(1),
  per_page:    z.coerce.number().int().positive().max(100).default(20),
  search:      z.string().optional(),
  status:      z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).optional(),
  priority:    z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigned_to: z.string().uuid().optional(),
  contact_id:      z.string().uuid().optional(),
  organization_id: z.string().uuid().optional(),
  category:    z.string().optional(),
  sort_by:     z.enum(['created_at', 'updated_at', 'priority', 'due_date']).default('created_at'),
  sort_order:  z.enum(['asc', 'desc']).default('desc'),
});

export const createCommentSchema = z.object({
  content:     z.string().min(1),
  is_internal: z.boolean().default(false),
});

export const assignTicketSchema = z.object({
  user_id: z.string().uuid(),
});

export type CreateTicketInput  = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput  = z.infer<typeof updateTicketSchema>;
export type ListTicketsQuery   = z.infer<typeof listTicketsQuerySchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type AssignTicketInput  = z.infer<typeof assignTicketSchema>;
