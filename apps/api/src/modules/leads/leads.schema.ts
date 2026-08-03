import { z } from 'zod';

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  email: z.string().trim().max(255).email('E-mail inválido'),
  company: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  message: z.string().trim().max(2000).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
