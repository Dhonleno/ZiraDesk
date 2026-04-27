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
  settings: z.record(z.unknown()).optional(),
});

export const listTenantsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['active', 'suspended', 'trial', 'cancelled']).optional(),
  search: z.string().optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;
