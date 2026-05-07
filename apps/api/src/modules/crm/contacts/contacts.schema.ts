import { z } from 'zod';

export const createContactSchema = z.object({
  organization_id: z.string().uuid().optional(),
  name:            z.string().min(2).max(150),
  email:           z.string().email().optional(),
  phone:           z.string().max(30).optional(),
  whatsapp:        z.string().max(30).optional(),
  document:        z.string().max(20).optional(),
  role:            z.string().max(100).optional(),
  department:      z.string().max(100).optional(),
  is_primary:      z.boolean().default(false),
  tags:            z.array(z.string()).optional(),
  custom_fields:   z.record(z.unknown()).optional(),
  notes:           z.string().optional(),
});

export const updateContactSchema = createContactSchema.partial();

export const listContactsQuerySchema = z.object({
  page:            z.coerce.number().int().positive().default(1),
  per_page:        z.coerce.number().int().positive().max(100).default(20),
  organization_id: z.string().uuid().optional(),
  search:          z.string().optional(),
  standalone_only: z.coerce.boolean().default(false),
});

export const linkOrganizationSchema = z.object({
  organization_id: z.string().uuid(),
});

export type CreateContactInput   = z.infer<typeof createContactSchema>;
export type UpdateContactInput   = z.infer<typeof updateContactSchema>;
export type ListContactsQuery    = z.infer<typeof listContactsQuerySchema>;
export type LinkOrganizationBody = z.infer<typeof linkOrganizationSchema>;
