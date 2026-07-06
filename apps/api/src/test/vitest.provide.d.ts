import 'vitest';
import type { StorageProvider } from '../lib/storage/index.js';

interface TestStorageProvider extends StorageProvider {
  clear(): void;
  has(key: string): boolean;
  keys(): string[];
}

declare global {
  // eslint-disable-next-line no-var
  var __ZIRADESK_TEST_STORAGE__: TestStorageProvider | undefined;
}

declare module 'vitest' {
  interface ProvidedContext {
    testBaseUrl: string;
    testTenantId: string;
    testTenantSlug: string;
    testTenantSchema: string;
  }
}

export {};
