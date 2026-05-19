import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { decryptCredentials } from '../utils/crypto.js';
import { ensureSmtpInfrastructure } from '../modules/admin/smtp/smtp.infrastructure.js';

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface ActiveSmtpRow {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from_email: string;
  from_name: string | null;
}

export interface SendEmailOptions {
  tenantId: string;
  tenantSchema: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: { name?: string; email?: string };
}

function validateSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error('INVALID_TENANT_SCHEMA');
  }
  return schemaName;
}

async function withTenantSchema<T>(
  schemaName: string,
  callback: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  const safeSchema = validateSchemaName(schemaName);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchema}", public`);
    await ensureSmtpInfrastructure(tx);
    return callback(tx);
  });
}

async function getActiveSmtpConfig(schemaName: string): Promise<ActiveSmtpRow | null> {
  return withTenantSchema(schemaName, async (tx) => {
    const rows = await tx.$queryRawUnsafe<ActiveSmtpRow[]>(
      `SELECT host, port, secure, username, password, from_email, from_name
         FROM smtp_configs
        WHERE is_active = true
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    return rows[0] ?? null;
  });
}

export async function hasTenantEmailProvider(tenantSchema: string): Promise<boolean> {
  const smtp = await getActiveSmtpConfig(tenantSchema);
  if (smtp) return true;
  return Boolean(env.RESEND_API_KEY);
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { tenantId, tenantSchema, to, subject, html, text } = options;
  const recipients = Array.isArray(to) ? to : [to];
  const smtp = await getActiveSmtpConfig(tenantSchema);

  if (smtp) {
    const decrypted = decryptCredentials(smtp.password);
    const smtpPassword = decrypted.password;
    if (!smtpPassword) {
      throw new Error('SMTP_PASSWORD_DECRYPT_ERROR');
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.username,
        pass: smtpPassword,
      },
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
      greetingTimeout: 10_000,
    });

    const fromName = options.from?.name ?? smtp.from_name ?? 'Suporte';
    const fromEmail = options.from?.email ?? smtp.from_email;

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: recipients.join(','),
      subject,
      html,
      text: text ?? '',
    });

    logger.info({ tenantId, to: recipients, subject }, '[Email] Sent via tenant SMTP');
    return;
  }

  if (!env.RESEND_API_KEY) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const fromEmail = options.from?.email ?? env.RESEND_FROM_EMAIL ?? 'noreply@ziradesk.com.br';
  const fromName = options.from?.name ?? 'ZiraDesk';

  const response = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: recipients,
    subject,
    html,
    text: text ?? '',
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  logger.info({ tenantId, to: recipients, subject }, '[Email] Sent via Resend fallback');
}

