import { Redis } from 'ioredis';
import { env } from './env.js';

interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<string>;
  del(key: string): Promise<number>;
  ping(): Promise<string>;
  disconnect(): void;
}

class InMemoryRedisClient implements RedisClientLike {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();

  private purgeIfExpired(key: string): void {
    const entry = this.store.get(key);
    if (!entry) {
      return;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.purgeIfExpired(key);
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<string> {
    let expiresAt: number | null = null;

    if (args[0] === 'EX' && typeof args[1] === 'number') {
      expiresAt = Date.now() + args[1] * 1000;
    }

    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.purgeIfExpired(key);
    const deleted = this.store.delete(key);
    return deleted ? 1 : 0;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  disconnect(): void {
    // no-op for in-memory test client
  }
}

const globalForRedis = globalThis as unknown as {
  __ZIRADESK_TEST_REDIS__?: RedisClientLike;
};

function createRedisClient(): RedisClientLike {
  if (env.NODE_ENV === 'test') {
    if (!globalForRedis.__ZIRADESK_TEST_REDIS__) {
      globalForRedis.__ZIRADESK_TEST_REDIS__ = new InMemoryRedisClient();
    }

    return globalForRedis.__ZIRADESK_TEST_REDIS__;
  }

  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export const redis = createRedisClient();
