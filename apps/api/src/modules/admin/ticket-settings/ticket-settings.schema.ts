import { z } from 'zod';

export const updateTicketSettingsSchema = z.object({
  ticket_auto_assign: z.boolean(),
});

export type UpdateTicketSettingsInput = z.infer<typeof updateTicketSettingsSchema>;
