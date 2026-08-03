import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type Prisma } from '@prisma/client';
import {
  enterPrismaContext,
  leavePrismaContext,
  prisma,
  rootPrisma,
  runWithRootPrismaContext,
} from '../config/database.js';
import { logger } from '../config/logger.js';

// Mesma whitelist usada em ~20 outros pontos do codebase (ex.: tickets.service.ts
// ensureSafeSchemaName) antes de interpolar schemaName em SQL raw.
const SAFE_SCHEMA_NAME = /^[a-z0-9_]+$/i;
const TENANT_REQUEST_TRANSACTION_TIMEOUT_MS = 120_000;

interface TenantRequestTransaction {
  done: Promise<void>;
  finish: (error?: Error) => void;
  rollbackExpected: boolean;
  schemaName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantPrismaTransaction?: TenantRequestTransaction;
  }
}

async function finishTenantPrismaTransaction(
  request: FastifyRequest,
  shouldRollback = false,
  cause?: Error,
): Promise<void> {
  const transaction = request.tenantPrismaTransaction;
  if (!transaction) return;

  delete request.tenantPrismaTransaction;
  leavePrismaContext();
  transaction.rollbackExpected = shouldRollback;
  transaction.finish(
    shouldRollback
      ? cause ?? new Error('Tenant request transaction rolled back')
      : undefined,
  );

  try {
    await transaction.done;
  } catch (err) {
    if (shouldRollback) return;
    throw err;
  }
}

export function registerTenantPrismaContextHooks(app: FastifyInstance): void {
  app.addHook('onRequest', (_request, _reply, done) => {
    runWithRootPrismaContext(done);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    try {
      await finishTenantPrismaTransaction(request, reply.statusCode >= 400);
    } catch (err) {
      logger.error({ err }, 'Tenant request transaction commit failed');
      reply.code(500).type('application/json');
      return JSON.stringify({ error: 'Falha ao persistir alterações do tenant' });
    }
    return payload;
  });

  app.addHook('onError', async (request, _reply, error) => {
    await finishTenantPrismaTransaction(request, true, error);
  });

  app.addHook('onResponse', async (request, reply) => {
    try {
      await finishTenantPrismaTransaction(request, reply.statusCode >= 400);
    } catch (err) {
      logger.error({ err }, 'Tenant request transaction cleanup failed');
    }
  });
}

async function bindTenantSchemaToRequest(
  schemaName: string,
  request: FastifyRequest,
): Promise<void> {
  let releaseTransaction!: () => void;
  let rejectTransaction!: (error: Error) => void;
  let resolveReady!: (tx: Prisma.TransactionClient) => void;
  let rejectReady!: (error: Error) => void;
  let released = false;

  const transactionDone = new Promise<void>((resolve, reject) => {
    releaseTransaction = resolve;
    rejectTransaction = reject;
  });

  const transactionReady = new Promise<Prisma.TransactionClient>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  let requestTransaction: TenantRequestTransaction | undefined;

  const transaction = rootPrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
      resolveReady(tx);
      await transactionDone;
    },
    {
      maxWait: 5_000,
      timeout: TENANT_REQUEST_TRANSACTION_TIMEOUT_MS,
    },
  );

  const done = transaction.catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    rejectReady(error);
    if (!requestTransaction?.rollbackExpected) {
      logger.error({ err: error.message, schemaName }, 'Tenant request transaction failed');
    }
    throw error;
  });
  done.catch(() => undefined);

  const finish = (error?: Error) => {
    if (released) return;
    released = true;
    if (error) {
      rejectTransaction(error);
      return;
    }
    releaseTransaction();
  };

  requestTransaction = {
    done,
    finish,
    rollbackExpected: false,
    schemaName,
  };
  request.tenantPrismaTransaction = requestTransaction;

  const tx = await transactionReady;
  enterPrismaContext(tx);
}

export async function tenantSchemaFromJwt(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user;
  const resolvedTenant = (request as FastifyRequest & { tenant?: { id: string; schemaName: string } }).tenant;

  if (!user || user.isSuperAdmin) {
    return reply.code(403).send({ error: 'Acesso não permitido' });
  }

  if (!user.tenantId) {
    return reply.code(401).send({ error: 'Token inválido: tenantId ausente' });
  }

  if (resolvedTenant && resolvedTenant.id !== user.tenantId) {
    return reply.code(403).send({ error: 'Acesso cross-tenant não permitido' });
  }

  // Fast path: schemaName already in JWT (tokens issued after this deploy)
  if (user.schemaName) {
    const schemaName = resolvedTenant?.schemaName ?? user.schemaName;

    if (!SAFE_SCHEMA_NAME.test(schemaName)) {
      return reply.code(403).send({ error: 'Schema do tenant inválido' });
    }

    request.user = {
      ...user,
      schemaName,
    };
    await bindTenantSchemaToRequest(schemaName, request);
    return;
  }

  // Fallback: lookup DB for tokens issued before schemaName was added to JWT
  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { schemaName: true, status: true },
  });

  if (!tenant) {
    return reply.code(404).send({ error: 'Tenant não encontrado' });
  }

  if (tenant.status !== 'active' && tenant.status !== 'trial') {
    return reply.code(403).send({
      success: false,
      error: { code: 'TENANT_SUSPENDED', message: 'Conta suspensa ou cancelada' },
    });
  }

  if (!SAFE_SCHEMA_NAME.test(tenant.schemaName)) {
    return reply.code(403).send({ error: 'Schema do tenant inválido' });
  }

  request.user = {
    ...user,
    schemaName: tenant.schemaName,
  };
  await bindTenantSchemaToRequest(tenant.schemaName, request);
}
