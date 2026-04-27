import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { prisma } from '../../../config/database.js';
import { env } from '../../../config/env.js';
import type { CreateChannelInput, UpdateChannelInput } from './channels.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

const ALGORITHM = 'aes-256-cbc';

function encryptCredentials(data: Record<string, unknown>): string {
  const iv = randomBytes(16);
  const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8');
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptCredentials(encrypted: string): Record<string, unknown> {
  const [ivHex, encHex] = encrypted.split(':');
  if (!ivHex || !encHex) return {};
  const iv = Buffer.from(ivHex, 'hex');
  const encBuffer = Buffer.from(encHex, 'hex');
  const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encBuffer), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  credentials: string;
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
  const settingsJson = JSON.stringify(data.settings ?? {});

  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `INSERT INTO channels (type, name, credentials, settings)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, type, name, status, settings, created_at`,
    data.type,
    data.name,
    encryptedCredentials,
    settingsJson,
  );
  return rows[0]!;
}

export async function updateChannel(id: string, data: UpdateChannelInput) {
  const existingRows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, credentials FROM channels WHERE id = $1 LIMIT 1`,
    id,
  );
  if (!existingRows[0]) throw new NotFoundError('Canal');

  const encryptedCredentials = data.credentials
    ? encryptCredentials(data.credentials)
    : existingRows[0].credentials;

  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `UPDATE channels
     SET name        = COALESCE($1, name),
         credentials = $2,
         settings    = COALESCE($3::jsonb, settings),
         status      = COALESCE($4, status)
     WHERE id = $5
     RETURNING id, type, name, status, settings, created_at`,
    data.name ?? null,
    encryptedCredentials,
    data.settings ? JSON.stringify(data.settings) : null,
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
