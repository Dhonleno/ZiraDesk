import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StorageObjectNotFoundError, type StorageProvider } from './storage.interface.js';

const BASE_DIR = path.resolve(process.cwd(), 'public', 'uploads');

function resolvePath(key: string): string {
  const resolved = path.resolve(BASE_DIR, key);
  if (!resolved.startsWith(path.resolve(BASE_DIR))) {
    throw new Error('Storage key inválido: path traversal detectado');
  }
  return resolved;
}

export class LocalStorageProvider implements StorageProvider {
  async upload(key: string, buffer: Buffer, _mimetype: string): Promise<string> {
    const filePath = resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return this.getUrl(key);
  }

  async delete(key: string): Promise<void> {
    const filePath = resolvePath(key);
    await fs.rm(filePath, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const filePath = resolvePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  getUrl(key: string): string {
    return `/api/files/${key}`;
  }

  async download(key: string): Promise<Buffer> {
    const filePath = resolvePath(key);
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }
}
