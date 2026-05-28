import { z } from 'zod';

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function optionalTrimmedString() {
  return z.preprocess(emptyToUndefined, z.string().optional());
}

function optionalEmail(envName: string) {
  return z.preprocess(emptyToUndefined, z.string().email(`${envName} deve ser um e-mail válido`).optional());
}

function optionalUrl(envName: string) {
  return z.preprocess(emptyToUndefined, z.string().url(`${envName} deve ser uma URL válida`).optional());
}

const envSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL deve ser uma URL válida'),
  REDIS_URL: z.string().url('REDIS_URL deve ser uma URL válida'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter no mínimo 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET deve ter no mínimo 32 caracteres'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: z.string().url('APP_URL deve ser uma URL válida'),
  ENCRYPTION_KEY: z.string().length(32, 'ENCRYPTION_KEY deve ter exatamente 32 caracteres'),
  WHATSAPP_PHONE_NUMBER_ID: z.string(),
  WHATSAPP_WABA_ID: z.string(),
  WHATSAPP_ACCESS_TOKEN: z.string(),
  WHATSAPP_VERIFY_TOKEN: z.string(),
  TWILIO_ACCOUNT_SID: z.string(),
  TWILIO_AUTH_TOKEN: z.string(),
  TWILIO_PHONE_NUMBER: z.string(),
  TWILIO_TWIML_APP_SID: z.string(),
  TWILIO_API_KEY: z.string(),
  TWILIO_API_SECRET: z.string(),
  API_URL: z.string(),
  REFRESH_COOKIE_NAME: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  // Storage
  STORAGE_PROVIDER: z.enum(['local', 'r2']).default('local'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
  // LGPD / DPO
  DPO_NAME: optionalTrimmedString(),
  DPO_EMAIL: optionalEmail('DPO_EMAIL'),
  DPO_PHONE: optionalTrimmedString(),
  PRIVACY_POLICY_URL: optionalUrl('PRIVACY_POLICY_URL'),
  TERMS_OF_SERVICE_URL: optionalUrl('TERMS_OF_SERVICE_URL'),
  COMPANY_LEGAL_NAME: optionalTrimmedString(),
  COMPANY_CNPJ: optionalTrimmedString(),
  SUPER_ADMIN_EMAIL: optionalEmail('SUPER_ADMIN_EMAIL'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
