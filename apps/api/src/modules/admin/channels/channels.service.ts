import { prisma } from '../../../config/database.js';
import { decryptCredentials, encryptCredentials } from '../../../utils/crypto.js';
import type { CreateChannelInput, UpdateChannelInput } from './channels.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  credentials: string | object;
  status: string;
  settings: unknown;
  created_at: Date;
}

interface ChannelRowPublic {
  id: string;
  type: string;
  name: string;
  status: string;
  settings: unknown;
  created_at: Date;
}

export async function listChannels() {
  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `SELECT id, type, name, status, settings, created_at FROM channels ORDER BY created_at DESC`,
  );
  return rows;
}

export async function getChannel(id: string) {
  const rows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, type, name, credentials, status, settings, created_at FROM channels WHERE id = $1 LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Canal');
  const { credentials, ...rest } = rows[0];
  return {
    ...rest,
    credentials: decryptCredentials(credentials),
  };
}

export async function createChannel(data: CreateChannelInput) {
  const encryptedCredentials = encryptCredentials(data.credentials);
  const credentialsJson = JSON.stringify(encryptedCredentials);
  const settingsJson = JSON.stringify(data.settings ?? {});

  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `INSERT INTO channels (type, name, credentials, settings)
     VALUES ($1, $2, $3::jsonb, $4::jsonb)
     RETURNING id, type, name, status, settings, created_at`,
    data.type,
    data.name,
    credentialsJson,
    settingsJson,
  );
  return rows[0]!;
}

export async function updateChannel(id: string, data: UpdateChannelInput) {
  const existingRows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, credentials, settings FROM channels WHERE id = $1 LIMIT 1`,
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
    `UPDATE channels
     SET name        = COALESCE($1, name),
         credentials = $2::jsonb,
         settings    = $3::jsonb,
         status      = COALESCE($4, status),
         updated_at  = NOW()
     WHERE id = $5
     RETURNING id, type, name, status, settings, created_at`,
    data.name ?? null,
    credentialsJson,
    JSON.stringify(mergedSettings),
    data.status ?? null,
    id,
  );
  return rows[0]!;
}

export async function deleteChannel(id: string) {
  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `UPDATE channels SET status = 'inactive' WHERE id = $1
     RETURNING id, type, name, status, settings, created_at`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Canal');
  return rows[0];
}

export async function testChannel(id: string) {
  const rows = await prisma.$queryRawUnsafe<[{ id: string; status: string }]>(
    `SELECT id, status FROM channels WHERE id = $1 LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Canal');
  return { connected: rows[0].status === 'active', channel_id: id };
}
