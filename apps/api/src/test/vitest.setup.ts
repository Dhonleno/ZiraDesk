import type { StorageProvider } from '../lib/storage/index.js';
import { beforeEach, inject, vi } from 'vitest';
import { redis } from '../config/redis.js';

class InMemoryStorageProvider implements StorageProvider {
  private readonly files = new Map<string, { buffer: Buffer; mimetype: string }>();

  async upload(key: string, buffer: Buffer, mimetype: string): Promise<string> {
    this.files.set(key, { buffer: Buffer.from(buffer), mimetype });
    return this.getUrl(key);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  getUrl(key: string): string {
    return `/api/files/${key}`;
  }

  async download(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    if (!file) {
      throw new Error('Arquivo não encontrado');
    }
    return Buffer.from(file.buffer);
  }

  clear(): void {
    this.files.clear();
  }

  has(key: string): boolean {
    return this.files.has(key);
  }

  keys(): string[] {
    return [...this.files.keys()];
  }
}

const storage = new InMemoryStorageProvider();

globalThis.__ZIRADESK_TEST_STORAGE__ = storage;

vi.mock('../services/email.service.js', () => ({
  sendEmail: vi.fn(async () => undefined),
  hasTenantEmailProvider: vi.fn(async () => true),
}));

vi.mock('twilio', () => {
  class AccessTokenMock {
    static VoiceGrant = class VoiceGrantMock {
      constructor(_opts?: unknown) {}
    };

    constructor(
      _accountSid: string,
      _apiKey: string,
      _apiSecret: string,
      _opts?: unknown,
    ) {}

    addGrant(_grant: unknown) {}

    toJwt(): string {
      return 'twilio-test-jwt';
    }
  }

  class VoiceResponseMock {
    dial(_opts?: unknown) {
      return {
        number: (_attrsOrNumber?: unknown, _maybeNumber?: unknown) => undefined,
      };
    }

    say(_text?: string) {}

    toString(): string {
      return '<Response />';
    }
  }

  const clientFactory = Object.assign(
    vi.fn(() => ({
      calls: Object.assign(
        vi.fn(() => ({
          recordings: {
            list: vi.fn(async () => []),
          },
        })),
        {
          create: vi.fn(async () => ({ sid: 'CA_TEST_SID' })),
        },
      ),
    })),
    {
      jwt: { AccessToken: AccessTokenMock },
      twiml: { VoiceResponse: VoiceResponseMock },
    },
  );

  return {
    default: clientFactory,
  };
});

vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({}),
  text: async () => '',
  arrayBuffer: async () => new ArrayBuffer(0),
})));

vi.mock('resend', () => ({
  Resend: class ResendMock {
    emails = {
      send: vi.fn(async () => ({ data: { id: 'email_mock_id' }, error: null })),
    };
  },
}));

async function clearRedisByPatterns(patterns: string[]): Promise<void> {
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

beforeEach(async () => {
  storage.clear();
  await clearRedisByPatterns([
    'auth:force_logout_after:*',
    'rate-limit:*',
    'fastify-rate-limit-*',
  ]);
});

const testBaseUrl = inject('testBaseUrl');
const testTenantId = inject('testTenantId');
const testTenantSlug = inject('testTenantSlug');
const testTenantSchema = inject('testTenantSchema');

globalThis.__ZIRADESK_TEST_BASE_URL__ = testBaseUrl;
globalThis.__ZIRADESK_TEST_TENANT_ID__ = testTenantId;
globalThis.__ZIRADESK_TEST_TENANT_SLUG__ = testTenantSlug;
globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__ = testTenantSchema;
