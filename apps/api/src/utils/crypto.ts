import { createDecipheriv } from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-cbc';

export function decryptCredentials(encrypted: string): Record<string, string> {
  const [ivHex, encHex] = encrypted.split(':');
  if (!ivHex || !encHex) return {};
  const iv = Buffer.from(ivHex, 'hex');
  const encBuffer = Buffer.from(encHex, 'hex');
  const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encBuffer), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as Record<string, string>;
}
