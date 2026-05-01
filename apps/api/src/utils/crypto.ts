import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-cbc';

function isCredentialsObject(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encryptCredentials(data: Record<string, unknown>): string {
  const iv = randomBytes(16);
  const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8');
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decryptCredentials(encrypted: string | object): Record<string, string> {
  if (isCredentialsObject(encrypted)) {
    return encrypted;
  }

  if (typeof encrypted !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(encrypted);
    if (isCredentialsObject(parsed)) {
      return parsed;
    }
    if (typeof parsed === 'string') {
      encrypted = parsed;
    }
  } catch {
    // Not plain JSON, continue with AES decrypt.
  }

  const [ivHex, encHex] = encrypted.split(':');
  if (!ivHex || !encHex) return {};
  const iv = Buffer.from(ivHex, 'hex');
  const encBuffer = Buffer.from(encHex, 'hex');
  const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encBuffer), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as Record<string, string>;
}
