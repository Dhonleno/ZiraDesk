import { z } from 'zod';

export const listCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled']).optional(),
});

export const createCampaignBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  channel_id: z.string().uuid(),
  template_id: z.string().uuid(),
  template_variables: z.record(z.string(), z.string()).default({}),
  template_header_media_url: z.string().trim().url().max(2000).nullable().optional(),
  template_header_media_filename: z.string().trim().max(255).nullable().optional(),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  daily_limit: z.coerce.number().int().positive().max(10000).default(500),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateCampaignBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  template_id: z.string().uuid().optional(),
  template_variables: z.record(z.string(), z.string()).optional(),
  template_header_media_url: z.string().trim().url().max(2000).nullable().optional(),
  template_header_media_filename: z.string().trim().max(255).nullable().optional(),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  daily_limit: z.coerce.number().int().positive().max(10000).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const addContactsBodySchema = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(1000).optional(),
  filter: z.object({
    search: z.string().trim().optional(),
    status: z.string().trim().optional(),
    tags: z.array(z.string().uuid()).max(50).optional(),
  }).optional(),
  exclude_ids: z.array(z.string().uuid()).max(1000).optional(),
}).refine(
  (data) => data.contact_ids !== undefined || data.filter !== undefined,
  'Informe contact_ids ou filter',
);

export const duplicateFailedCampaignBodySchema = createCampaignBodySchema.omit({
  channel_id: true,
});

export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;
export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;
export type UpdateCampaignBody = z.infer<typeof updateCampaignBodySchema>;
export type AddContactsBody = z.infer<typeof addContactsBodySchema>;
export type DuplicateFailedCampaignBody = z.infer<typeof duplicateFailedCampaignBodySchema>;
