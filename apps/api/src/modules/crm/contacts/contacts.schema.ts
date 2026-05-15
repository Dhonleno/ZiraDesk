import { z } from 'zod';
import { isValidPhoneNumber } from 'libphonenumber-js';

function isValidOptionalPhone(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return true;

  try {
    return isValidPhoneNumber(value);
  } catch {
    return false;
  }
}

export const createContactSchema = z.object({
  organization_id: z.string().uuid().optional(),
  name:            z.string().min(2).max(150),
  email:           z.string().email().optional(),
  phone:           z.string().max(30).optional().refine(isValidOptionalPhone, { message: 'Número de telefone inválido' }),
  whatsapp:        z.string().max(30).optional().refine(isValidOptionalPhone, { message: 'Número de telefone inválido' }),
  document:        z.string().max(20).optional(),
  role:            z.string().max(100).optional(),
  department:      z.string().max(100).optional(),
  is_primary:      z.boolean().default(false),
  tags:            z.array(z.string()).optional(),
  custom_fields:   z.record(z.unknown()).optional(),
  notes:           z.string().optional(),
});

const updateContactSchemaBase = z.object({
  organization_id: z.string().uuid().nullable().optional(),
  organizationId:  z.string().uuid().nullable().optional(),
  name:            z.string().min(2).max(150).nullable().optional(),
  email:           z.string().email().nullable().optional(),
  phone:           z.string().max(30).nullable().optional().refine(isValidOptionalPhone, { message: 'Número de telefone inválido' }),
  whatsapp:        z.string().max(30).nullable().optional().refine(isValidOptionalPhone, { message: 'Número de telefone inválido' }),
  document:        z.string().max(20).nullable().optional(),
  role:            z.string().max(100).nullable().optional(),
  department:      z.string().max(100).nullable().optional(),
  is_primary:      z.boolean().nullable().optional(),
  tags:            z.array(z.string()).nullable().optional(),
  custom_fields:   z.record(z.unknown()).nullable().optional(),
  notes:           z.string().nullable().optional(),
});

export const updateContactSchema = updateContactSchemaBase.transform(({ organizationId, organization_id, ...rest }) => ({
  ...rest,
  organization_id: organizationId ?? organization_id,
}));

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
