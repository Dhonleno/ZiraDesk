import { z } from 'zod';

const ticketStatuses = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;

export const portalLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenant_slug: z.string().min(2).max(100).optional(),
});

export const portalTicketsQuerySchema = z.object({
  status: z.enum(ticketStatuses).optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
});

export const portalCreateTicketSchema = z.object({
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(5000).optional(),
  type_id: z.string().uuid().optional(),
});

export const portalAddCommentSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

export const portalForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const portalResetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});

export const portalLgpdConsentSchema = z.object({
  status: z.enum(['pending', 'granted', 'denied', 'revoked']),
  source: z.string().trim().min(2).max(100).optional(),
});

export const portalLgpdRequestSchema = z.object({
  request_type: z.enum(['access', 'anonymization']),
  reason: z.string().trim().min(3).max(500).optional(),
  include_messages: z.coerce.boolean().optional(),
});

export type PortalLoginInput = z.infer<typeof portalLoginSchema>;
export type PortalTicketsQuery = z.infer<typeof portalTicketsQuerySchema>;
export type PortalCreateTicketInput = z.infer<typeof portalCreateTicketSchema>;
export type PortalAddCommentInput = z.infer<typeof portalAddCommentSchema>;
export type PortalLgpdConsentInput = z.infer<typeof portalLgpdConsentSchema>;
export type PortalLgpdRequestInput = z.infer<typeof portalLgpdRequestSchema>;
