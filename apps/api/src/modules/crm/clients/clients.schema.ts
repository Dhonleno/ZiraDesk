import { z } from 'zod';

export const createClientSchema = z.object({
  type: z.enum(['person', 'company']).default('person'),
  name: z.string().min(2).max(150),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  document: z.string().max(20).optional(),
  website: z.string().url().optional(),
  status: z.enum(['lead', 'prospect', 'cliente', 'vip', 'negociando', 'inativo']).default('lead'),
  address_street: z.string().max(200).optional(),
  address_city: z.string().max(100).optional(),
  address_state: z.string().max(2).optional(),
  address_zip: z.string().max(10).optional(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.string().max(20).optional(),
  occupation: z.string().max(100).optional(),
  income: z.number().nonnegative().optional(),
  segment: z.string().max(100).optional(),
  lead_source: z.string().max(100).optional(),
  responsible_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.unknown()).optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const listClientsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.enum(['lead', 'prospect', 'cliente', 'vip', 'negociando', 'inativo']).optional(),
  type: z.enum(['person', 'company']).optional(),
  responsible_id: z.string().uuid().optional(),
  tag: z.string().optional(),
  segment: z.string().optional(),
  sort_by: z.enum(['name', 'created_at', 'updated_at', 'last_contact']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

export const tagBodySchema = z.object({
  tag: z.string().min(1).max(50),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type TagBody = z.infer<typeof tagBodySchema>;
