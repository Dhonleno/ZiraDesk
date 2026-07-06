import { z } from 'zod';

export const makeCallBodySchema = z.object({
  to_phone: z.string().min(8, 'Telefone inválido'),
  conversation_id: z.string().uuid('conversation_id inválido'),
});

export const conversationParamsSchema = z.object({
  id: z.string().uuid('ID da conversa inválido'),
});

export interface TwilioIncomingCallBody {
  To: string;
  From: string;
  CallSid: string;
}

export interface TwilioGatherBody extends TwilioIncomingCallBody {
  Digits?: string;
}

export interface BotOptionRow {
  id: string;
  number: number;
  label: string;
}

export type MakeCallBody = z.infer<typeof makeCallBodySchema>;
