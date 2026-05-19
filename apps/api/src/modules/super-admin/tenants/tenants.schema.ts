import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  planId: z.string().cuid(),
  ownerName: z.string().min(1).max(100),
  ownerEmail: z.string().email(),
  trialDays: z.number().int().positive().default(14),
});

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  planId: z.string().cuid().optional(),
  status: z.enum(['active', 'suspended', 'trial', 'cancelled']).optional(),
  trialEndsAt: z.coerce.date().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const listTenantsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['active', 'suspended', 'trial', 'cancelled']).optional(),
  search: z.string().optional(),
});

export const slugAvailabilityQuerySchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
});

export const superAdminTenantUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
});

export const superAdminTenantInviteUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'agent', 'viewer']),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;
export type SlugAvailabilityQuery = z.infer<typeof slugAvailabilityQuerySchema>;
export type SuperAdminTenantUsersQuery = z.infer<typeof superAdminTenantUsersQuerySchema>;
export type SuperAdminTenantInviteUserInput = z.infer<typeof superAdminTenantInviteUserSchema>;
