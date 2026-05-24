import { prisma } from '../../../config/database.js';
import { env } from '../../../config/env.js';
import { decryptCredentials, encryptCredentials } from '../../../utils/crypto.js';
import { hasTenantEmailProvider } from '../../../services/email.service.js';
import type { CreateChannelInput, UpdateChannelInput } from './channels.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

function validateSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }

  return schemaName;
}

function channelsTable(schemaName: string): string {
  return `"${validateSchemaName(schemaName)}".channels`;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  credentials: string | object;
  status: string;
  settings: unknown;
  last_tested_at: Date | null;
  last_test_ok: boolean | null;
  created_at: Date;
}

interface ChannelRowPublic {
  id: string;
  type: string;
  name: string;
  status: string;
  settings: unknown;
  last_tested_at: Date | null;
  last_test_ok: boolean | null;
  created_at: Date;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractMetaErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const top = payload as { error?: unknown };
  if (!top.error || typeof top.error !== 'object') return null;
  const nested = top.error as { message?: unknown };
  return typeof nested.message === 'string' ? nested.message.trim() : null;
}

async function ensureChannelsInfrastructure(schemaName: string): Promise<void> {
  const tableRef = channelsTable(schemaName);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${tableRef} (
       id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
       type        VARCHAR(30)  NOT NULL,
       name        VARCHAR(100) NOT NULL,
       credentials JSONB        NOT NULL DEFAULT '{}',
       status      VARCHAR(20)  NOT NULL DEFAULT 'active',
       settings    JSONB        NOT NULL DEFAULT '{}',
       created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ${tableRef}
       ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ${tableRef}
       ADD COLUMN IF NOT EXISTS last_test_ok BOOLEAN`,
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testWhatsAppChannel(credentials: Record<string, unknown>): Promise<void> {
  const phoneNumberId = asTrimmedString(
    credentials.phoneNumberId ?? credentials.phone_number_id ?? env.WHATSAPP_PHONE_NUMBER_ID,
  );
  const accessToken = asTrimmedString(
    credentials.accessToken ?? credentials.access_token ?? env.WHATSAPP_ACCESS_TOKEN,
  );

  if (!phoneNumberId || !accessToken) {
    throw new Error('Credenciais WhatsApp incompletas');
  }

  const response = await fetchWithTimeout(
    `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}?fields=id`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    let message = `Falha na validação do WhatsApp (HTTP ${response.status})`;
    try {
      const payload = await response.json() as unknown;
      message = extractMetaErrorMessage(payload) ?? message;
    } catch {
      // noop
    }
    throw new Error(message);
  }
}

async function testInstagramChannel(credentials: Record<string, unknown>): Promise<void> {
  const pageId = asTrimmedString(credentials.page_id ?? credentials.pageId);
  const accessToken = asTrimmedString(credentials.access_token ?? credentials.accessToken);

  if (!pageId || !accessToken) {
    throw new Error('Credenciais Instagram incompletas');
  }

  const response = await fetchWithTimeout(
    `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}?fields=id`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    let message = `Falha na validação do Instagram (HTTP ${response.status})`;
    try {
      const payload = await response.json() as unknown;
      message = extractMetaErrorMessage(payload) ?? message;
    } catch {
      // noop
    }
    throw new Error(message);
  }
}

async function testEmailChannel(schemaName: string): Promise<void> {
  const providerConfigured = await hasTenantEmailProvider(schemaName);
  if (!providerConfigured) {
    throw new Error('Provedor de e-mail não configurado');
  }
}

export async function listChannels(schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `SELECT id, type, name, status, settings, last_tested_at, last_test_ok, created_at
       FROM ${tableRef}
      ORDER BY created_at DESC`,
  );
  return rows;
}

export async function getChannel(id: string, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, type, name, credentials, status, settings, last_tested_at, last_test_ok, created_at
       FROM ${tableRef}
      WHERE id = $1::uuid
      LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Canal');
  const { credentials, ...rest } = rows[0];
  return {
    ...rest,
    credentials: decryptCredentials(credentials),
  };
}

export async function createChannel(data: CreateChannelInput, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const encryptedCredentials = encryptCredentials(data.credentials);
  const credentialsJson = JSON.stringify(encryptedCredentials);
  const settingsJson = JSON.stringify(data.settings ?? {});

  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `INSERT INTO ${tableRef} (type, name, credentials, settings)
     VALUES ($1, $2, $3::jsonb, $4::jsonb)
     RETURNING id, type, name, status, settings, last_tested_at, last_test_ok, created_at`,
    data.type,
    data.name,
    credentialsJson,
    settingsJson,
  );
  return rows[0]!;
}

export async function updateChannel(id: string, data: UpdateChannelInput, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const existingRows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, credentials, settings, last_tested_at, last_test_ok
       FROM ${tableRef}
      WHERE id = $1::uuid
      LIMIT 1`,
    id,
  );
  if (!existingRows[0]) throw new NotFoundError('Canal');

  const currentCredentials = decryptCredentials(existingRows[0].credentials);
  const incomingCredentials = data.credentials ?? {};
  const mergedCredentials = data.credentials
    ? { ...currentCredentials, ...incomingCredentials }
    : currentCredentials;

  if (
    data.credentials
    && (!Object.prototype.hasOwnProperty.call(data.credentials, 'accessToken')
      || !String(data.credentials.accessToken ?? '').trim())
    && currentCredentials.accessToken
  ) {
    mergedCredentials.accessToken = currentCredentials.accessToken;
  }

  const encryptedCredentials = encryptCredentials(mergedCredentials);
  const credentialsJson = JSON.stringify(encryptedCredentials);

  const currentSettings = (existingRows[0].settings as Record<string, unknown>) ?? {};
  const mergedSettings = data.settings ? { ...currentSettings, ...data.settings } : currentSettings;

  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `UPDATE ${tableRef}
     SET name        = COALESCE($1, name),
         credentials = $2::jsonb,
         settings    = $3::jsonb,
         status      = COALESCE($4, status)
     WHERE id = $5::uuid
     RETURNING id, type, name, status, settings, last_tested_at, last_test_ok, created_at`,
    data.name ?? null,
    credentialsJson,
    JSON.stringify(mergedSettings),
    data.status ?? null,
    id,
  );
  return rows[0]!;
}

export async function deleteChannel(id: string, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `UPDATE ${tableRef}
        SET status = 'inactive',
            last_test_ok = false,
            last_tested_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, type, name, status, settings, last_tested_at, last_test_ok, created_at`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Canal');
  return rows[0];
}

export async function testChannel(id: string, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, type, name, credentials, status, settings, last_tested_at, last_test_ok, created_at
       FROM ${tableRef}
      WHERE id = $1::uuid
      LIMIT 1`,
    id,
  );
  const channel = rows[0];
  if (!channel) throw new NotFoundError('Canal');

  const credentials = decryptCredentials(channel.credentials) as Record<string, unknown>;

  let connected = false;

  try {
    switch (channel.type) {
      case 'whatsapp':
        await testWhatsAppChannel(credentials);
        connected = true;
        break;
      case 'instagram':
        await testInstagramChannel(credentials);
        connected = true;
        break;
      case 'email':
        await testEmailChannel(schemaName);
        connected = true;
        break;
      case 'webchat':
        connected = true;
        break;
      default:
        throw new Error('Tipo de canal não suportado para teste');
    }
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${tableRef}
          SET last_tested_at = NOW(),
              last_test_ok = false
        WHERE id = $1::uuid`,
      id,
    );
    throw error;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${tableRef}
        SET last_tested_at = NOW(),
            last_test_ok = $2
      WHERE id = $1::uuid`,
    id,
    connected,
  );

  return { connected, channel_id: id };
}
