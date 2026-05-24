import type { StorageProvider } from './storage.interface.js';
import { LocalStorageProvider } from './local.provider.js';
import { R2StorageProvider } from './r2.provider.js';

declare global {
  // eslint-disable-next-line no-var
  var __ZIRADESK_TEST_STORAGE__: StorageProvider | undefined;
}

let _instance: StorageProvider | null = null;

function getTestStorageOverride(): StorageProvider | null {
  if (process.env['NODE_ENV'] !== 'test') {
    return null;
  }

  return globalThis.__ZIRADESK_TEST_STORAGE__ ?? null;
}

export function getStorage(): StorageProvider {
  const testStorage = getTestStorageOverride();
  if (testStorage) {
    return testStorage;
  }

  if (!_instance) {
    const provider = process.env['STORAGE_PROVIDER'] ?? 'local';
    _instance = provider === 'r2' ? new R2StorageProvider() : new LocalStorageProvider();
  }
  return _instance;
}

export type { StorageProvider } from './storage.interface.js';
