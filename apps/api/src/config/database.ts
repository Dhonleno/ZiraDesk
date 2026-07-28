import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient, type Prisma } from '@prisma/client';
import { env } from './env.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;
type PrismaContextStore = { active: boolean; client: PrismaExecutor };

const prismaContext = new AsyncLocalStorage<PrismaContextStore>();
const ROOT_PRISMA_MODEL_PROPS = new Set<PropertyKey>([
  'plan',
  'tenant',
  'usageSnapshot',
  'subscription',
  'superAdmin',
]);

export const rootPrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

// Em dev, preserva a instância entre hot-reloads do tsx
if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = rootPrisma;
}

function currentPrisma(): PrismaExecutor {
  const store = prismaContext.getStore();
  if (!store || !store.active) return rootPrisma;
  return store.client;
}

export function enterPrismaContext(client: PrismaExecutor): void {
  const store = prismaContext.getStore();
  if (store) {
    store.active = true;
    store.client = client;
    return;
  }
  prismaContext.enterWith({ active: true, client });
}

export function runWithPrismaContext<T>(client: PrismaExecutor, fn: () => T): T {
  return prismaContext.run({ active: true, client }, fn);
}

export function runWithRootPrismaContext<T>(fn: () => T): T {
  return prismaContext.run({ active: true, client: rootPrisma }, fn);
}

export function leavePrismaContext(): void {
  const store = prismaContext.getStore();
  if (store) {
    store.active = false;
  }
}

export const prisma = new Proxy(rootPrisma, {
  get(target, prop, receiver) {
    const client = currentPrisma();

    if (prop === '$transaction' && client !== target) {
      return async (
        input:
          | ((tx: Prisma.TransactionClient) => Promise<unknown>)
          | Parameters<PrismaClient['$transaction']>[0],
        ...args: unknown[]
      ) => {
        if (typeof input === 'function') {
          return input(client as Prisma.TransactionClient);
        }
        return (target.$transaction as (...params: unknown[]) => unknown)(input, ...args);
      };
    }

    if (prop === '$connect' || prop === '$disconnect' || prop === '$on' || prop === '$use') {
      const rootValue = Reflect.get(target, prop, receiver);
      return typeof rootValue === 'function' ? rootValue.bind(target) : rootValue;
    }

    if (ROOT_PRISMA_MODEL_PROPS.has(prop)) {
      const rootValue = Reflect.get(target, prop, receiver);
      return typeof rootValue === 'function' ? rootValue.bind(target) : rootValue;
    }

    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as PrismaClient;
