import { z } from 'zod';

export const inviteUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'supervisor', 'agent', 'viewer']),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['owner', 'admin', 'supervisor', 'agent', 'viewer']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  max_conversations: z.number().int().min(1).max(500).nullable().optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
});

export const updateUserLgpdConsentSchema = z.object({
  status: z.enum(['pending', 'granted', 'denied', 'revoked']),
  source: z.string().min(2).max(100).optional(),
});

export const exportUserLgpdQuerySchema = z.object({
  include_audit_logs: z.coerce.boolean().default(true),
});

export const anonymizeUserLgpdSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const listUserLgpdRequestsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
  user_id: z.string().uuid().optional(),
  request_type: z.enum(['access', 'consent_update', 'anonymization']).optional(),
  status: z.string().max(30).optional(),
});

export const submitAnonymizeRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserLgpdConsentInput = z.infer<typeof updateUserLgpdConsentSchema>;
export type ExportUserLgpdQuery = z.infer<typeof exportUserLgpdQuerySchema>;
export type AnonymizeUserLgpdInput = z.infer<typeof anonymizeUserLgpdSchema>;
export type ListUserLgpdRequestsQuery = z.infer<typeof listUserLgpdRequestsQuerySchema>;
export type SubmitAnonymizeRequestInput = z.infer<typeof submitAnonymizeRequestSchema>;
