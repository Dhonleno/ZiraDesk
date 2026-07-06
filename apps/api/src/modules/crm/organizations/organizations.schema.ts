import { z } from 'zod';

export const createOrganizationSchema = z.object({
  type:           z.enum(['company', 'person']).default('company'),
  name:           z.string().min(2).max(150),
  document:       z.string().max(20).optional(),
  email:          z.string().email().optional(),
  phone:          z.string().max(30).optional(),
  website:        z.string().max(255).optional(),
  status:         z.enum(['lead', 'prospect', 'client', 'inactive']).default('lead'),
  address_street: z.string().max(200).optional(),
  address_city:   z.string().max(100).optional(),
  address_state:  z.string().max(2).optional(),
  address_zip:    z.string().max(10).optional(),
  segment:        z.string().max(100).optional(),
  lead_source:    z.string().max(100).optional(),
  responsible_id: z.string().uuid().optional(),
  tags:           z.array(z.string()).optional(),
  custom_fields:  z.record(z.unknown()).optional(),
  notes:          z.string().optional(),
});

export const updateOrganizationSchema = z.object({
  type:           z.enum(['company', 'person']).optional(),
  name:           z.string().min(2).max(150).optional(),
  document:       z.string().max(20).nullable().optional(),
  email:          z.string().email().nullable().optional(),
  phone:          z.string().max(30).nullable().optional(),
  website:        z.string().max(255).nullable().optional(),
  status:         z.enum(['lead', 'prospect', 'client', 'inactive']).optional(),
  address_street: z.string().max(200).nullable().optional(),
  address_city:   z.string().max(100).nullable().optional(),
  address_state:  z.string().max(2).nullable().optional(),
  address_zip:    z.string().max(10).nullable().optional(),
  segment:        z.string().max(100).nullable().optional(),
  lead_source:    z.string().max(100).nullable().optional(),
  responsible_id: z.string().uuid().nullable().optional(),
  tags:           z.array(z.string()).nullable().optional(),
  custom_fields:  z.record(z.unknown()).nullable().optional(),
  notes:          z.string().nullable().optional(),
});

export const listOrganizationsQuerySchema = z.object({
  page:           z.coerce.number().int().positive().default(1),
  per_page:       z.coerce.number().int().positive().max(100).default(20),
  search:         z.string().optional(),
  status:         z.enum(['lead', 'prospect', 'client', 'inactive']).optional(),
  segment:        z.string().optional(),
  responsible_id: z.string().uuid().optional(),
  tag:            z.string().optional(),
  sort_by:        z.enum(['name', 'created_at', 'updated_at']).default('created_at'),
  sort_order:     z.enum(['asc', 'desc']).default('desc'),
});

export const countOrganizationsQuerySchema = listOrganizationsQuerySchema.pick({
  search: true,
  status: true,
  segment: true,
  responsible_id: true,
  tag: true,
});

export const bulkDeleteOrganizationsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100).optional(),
  filter: countOrganizationsQuerySchema.optional(),
  exclude_ids: z.array(z.string().uuid()).max(1000).optional(),
}).refine(
  (data) => data.ids !== undefined || data.filter !== undefined,
  'Informe ids ou filter',
);

export type CreateOrganizationInput  = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput  = z.infer<typeof updateOrganizationSchema>;
export type ListOrganizationsQuery   = z.infer<typeof listOrganizationsQuerySchema>;
export type CountOrganizationsQuery  = z.infer<typeof countOrganizationsQuerySchema>;
export type BulkDeleteOrganizationsInput = z.infer<typeof bulkDeleteOrganizationsSchema>;
