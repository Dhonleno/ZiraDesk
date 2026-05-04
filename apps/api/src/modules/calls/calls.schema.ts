import { z } from 'zod';

export const makeCallBodySchema = z.object({
  to_phone: z.string().min(8, 'Telefone inválido'),
  conversation_id: z.string().uuid('conversation_id inválido'),
});

export const conversationParamsSchema = z.object({
  id: z.string().uuid('ID da conversa inválido'),
});

export type MakeCallBody = z.infer<typeof makeCallBodySchema>;
