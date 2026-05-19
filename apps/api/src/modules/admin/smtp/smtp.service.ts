import nodemailer from 'nodemailer';
import { prisma } from '../../../config/database.js';
import { decryptCredentials, encryptCredentials } from '../../../utils/crypto.js';
import { ensureSmtpInfrastructure } from './smtp.infrastructure.js';
import type { SmtpInput, SmtpTestInput, SmtpUpdateInput } from './smtp.schema.js';

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface SmtpConfigRow {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from_email: string;
  from_name: string | null;
  is_active: boolean;
  last_tested_at: Date | null;
  last_test_ok: boolean | null;
  created_at: Date;
  updated_at: Date;
}

export interface SmtpConfigPublic {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromEmail: string;
  fromName: string | null;
  isActive: boolean;
  hasPassword: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SmtpConfigNotFoundError extends Error {
  constructor() {
    super('Configuração SMTP não encontrada');
    this.name = 'SmtpConfigNotFoundError';
  }
}

export class SmtpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpValidationError';
  }
}

function validateSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new SmtpValidationError('Schema do tenant inválido');
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

function toPublicConfig(row: SmtpConfigRow): SmtpConfigPublic {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    fromEmail: row.from_email,
    fromName: row.from_name,
    isActive: row.is_active,
    hasPassword: Boolean(row.password),
    lastTestedAt: row.last_tested_at,
    lastTestOk: row.last_test_ok,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getLatestConfigRow(tx: PrismaTx): Promise<SmtpConfigRow | null> {
  const rows = await tx.$queryRawUnsafe<SmtpConfigRow[]>(
    `SELECT id, host, port, secure, username, password, from_email, from_name, is_active,
            last_tested_at, last_test_ok, created_at, updated_at
       FROM smtp_configs
      ORDER BY created_at DESC
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getSmtpConfig(schemaName: string): Promise<SmtpConfigPublic | null> {
  return withTenantSchema(schemaName, async (tx) => {
    const row = await getLatestConfigRow(tx);
    return row ? toPublicConfig(row) : null;
  });
}

export async function saveSmtpConfig(schemaName: string, data: SmtpInput): Promise<SmtpConfigPublic> {
  return withTenantSchema(schemaName, async (tx) => {
    const existing = await getLatestConfigRow(tx);
    const encrypted = encryptCredentials({ password: data.password });
    const fromName = data.fromName?.trim() || null;

    if (!existing) {
      const rows = await tx.$queryRawUnsafe<SmtpConfigRow[]>(
        `INSERT INTO smtp_configs (
           host, port, secure, username, password, from_email, from_name, is_active, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
         RETURNING id, host, port, secure, username, password, from_email, from_name, is_active,
                   last_tested_at, last_test_ok, created_at, updated_at`,
        data.host.trim(),
        data.port,
        data.secure,
        data.username.trim(),
        encrypted,
        data.fromEmail.trim(),
        fromName,
      );
      return toPublicConfig(rows[0]!);
    }

    const rows = await tx.$queryRawUnsafe<SmtpConfigRow[]>(
      `UPDATE smtp_configs
          SET host = $1,
              port = $2,
              secure = $3,
              username = $4,
              password = $5,
              from_email = $6,
              from_name = $7,
              is_active = true,
              updated_at = NOW()
        WHERE id = $8::uuid
      RETURNING id, host, port, secure, username, password, from_email, from_name, is_active,
                last_tested_at, last_test_ok, created_at, updated_at`,
      data.host.trim(),
      data.port,
      data.secure,
      data.username.trim(),
      encrypted,
      data.fromEmail.trim(),
      fromName,
      existing.id,
    );

    return toPublicConfig(rows[0]!);
  });
}

export async function updateSmtpConfig(schemaName: string, data: SmtpUpdateInput): Promise<SmtpConfigPublic> {
  return withTenantSchema(schemaName, async (tx) => {
    const existing = await getLatestConfigRow(tx);
    if (!existing) throw new SmtpConfigNotFoundError();

    const nextPassword = data.password
      ? encryptCredentials({ password: data.password })
      : existing.password;

    const rows = await tx.$queryRawUnsafe<SmtpConfigRow[]>(
      `UPDATE smtp_configs
          SET host = COALESCE($1, host),
              port = COALESCE($2, port),
              secure = COALESCE($3, secure),
              username = COALESCE($4, username),
              password = $5,
              from_email = COALESCE($6, from_email),
              from_name = COALESCE($7, from_name),
              is_active = COALESCE($8, is_active),
              updated_at = NOW()
        WHERE id = $9::uuid
      RETURNING id, host, port, secure, username, password, from_email, from_name, is_active,
                last_tested_at, last_test_ok, created_at, updated_at`,
      data.host?.trim() ?? null,
      data.port ?? null,
      data.secure ?? null,
      data.username?.trim() ?? null,
      nextPassword,
      data.fromEmail?.trim() ?? null,
      data.fromName?.trim() ?? null,
      true,
      existing.id,
    );

    return toPublicConfig(rows[0]!);
  });
}

export async function deleteSmtpConfig(schemaName: string): Promise<{ deleted: boolean }> {
  return withTenantSchema(schemaName, async (tx) => {
    const result = await tx.$executeRawUnsafe(`DELETE FROM smtp_configs`);
    return { deleted: Number(result) > 0 };
  });
}

interface ResolvedSmtpCredentials {
  rowId: string | null;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string | null;
}

async function resolveSmtpCredentialsForTest(
  tx: PrismaTx,
  input: SmtpTestInput,
): Promise<ResolvedSmtpCredentials> {
  const existing = await getLatestConfigRow(tx);

  const decryptedExistingPassword = existing
    ? decryptCredentials(existing.password).password
    : undefined;

  const merged = {
    host: input.host?.trim() ?? existing?.host,
    port: input.port ?? existing?.port,
    secure: input.secure ?? existing?.secure,
    username: input.username?.trim() ?? existing?.username,
    password: input.password ?? decryptedExistingPassword,
    fromEmail: input.fromEmail?.trim() ?? existing?.from_email,
    fromName: input.fromName?.trim() ?? existing?.from_name ?? undefined,
  };

  if (
    !merged.host
    || !merged.port
    || typeof merged.secure !== 'boolean'
    || !merged.username
    || !merged.password
    || !merged.fromEmail
  ) {
    throw new SmtpValidationError('Configuração SMTP incompleta para teste');
  }

  return {
    rowId: existing?.id ?? null,
    host: merged.host,
    port: merged.port,
    secure: merged.secure,
    username: merged.username,
    password: merged.password,
    fromEmail: merged.fromEmail,
    fromName: merged.fromName ?? null,
  };
}

export async function testSmtpConfig(schemaName: string, input: SmtpTestInput): Promise<void> {
  const resolved = await withTenantSchema(schemaName, async (tx) =>
    resolveSmtpCredentialsForTest(tx, input),
  );

  const transporter = nodemailer.createTransport({
    host: resolved.host,
    port: resolved.port,
    secure: resolved.secure,
    auth: {
      user: resolved.username,
      pass: resolved.password,
    },
    connectionTimeout: 10_000,
    socketTimeout: 10_000,
    greetingTimeout: 10_000,
  });

  try {
    await transporter.verify();
    await transporter.sendMail({
      from: `"${resolved.fromName ?? 'ZiraDesk'}" <${resolved.fromEmail}>`,
      to: resolved.fromEmail,
      subject: 'Teste de configuração SMTP - ZiraDesk',
      text: 'Sua configuração SMTP está funcionando corretamente!',
    });

    if (resolved.rowId) {
      await withTenantSchema(schemaName, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE smtp_configs
              SET last_tested_at = NOW(),
                  last_test_ok = true,
                  updated_at = NOW()
            WHERE id = $1::uuid`,
          resolved.rowId,
        );
      });
    }
  } catch (error) {
    if (resolved.rowId) {
      await withTenantSchema(schemaName, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE smtp_configs
              SET last_tested_at = NOW(),
                  last_test_ok = false,
                  updated_at = NOW()
            WHERE id = $1::uuid`,
          resolved.rowId,
        );
      });
    }
    throw error;
  }
}
