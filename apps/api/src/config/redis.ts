import type { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env.js';

interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<string>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  expire(key: string, seconds: number): Promise<number>;
  exists(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
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

  async setex(key: string, seconds: number, value: string): Promise<string> {
    return this.set(key, value, 'EX', seconds);
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.purgeIfExpired(key);
    const current = this.store.get(key);
    if (!current) {
      return 0;
    }

    current.expiresAt = Date.now() + seconds * 1000;
    this.store.set(key, current);
    return 1;
  }

  async exists(key: string): Promise<number> {
    this.purgeIfExpired(key);
    return this.store.has(key) ? 1 : 0;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      this.purgeIfExpired(key);
      if (this.store.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async keys(pattern: string): Promise<string[]> {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    const allKeys = [...this.store.keys()];
    const matched: string[] = [];
    for (const key of allKeys) {
      this.purgeIfExpired(key);
      if (this.store.has(key) && regex.test(key)) {
        matched.push(key);
      }
    }
    return matched;
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
export const bullmqConnection = redis as unknown as ConnectionOptions;
