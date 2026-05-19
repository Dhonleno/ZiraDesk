import { z } from 'zod';

export const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
});

export const smtpUpdateSchema = smtpSchema.partial().extend({
  password: z.string().min(1).optional(),
});

export const smtpTestSchema = smtpUpdateSchema;

export type SmtpInput = z.infer<typeof smtpSchema>;
export type SmtpUpdateInput = z.infer<typeof smtpUpdateSchema>;
export type SmtpTestInput = z.infer<typeof smtpTestSchema>;

