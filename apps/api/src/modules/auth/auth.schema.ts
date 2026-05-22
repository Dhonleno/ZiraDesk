import { z } from 'zod';

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantSlug: z.string().optional(),
});

export const forgotPasswordBodySchema = z.object({
  email: z.string().email(),
});

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    role: z.string(),
  }),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
