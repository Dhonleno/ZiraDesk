import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

export type UsageMetric = 'messages_sent' | 'storage_bytes' | 'active_users';

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function redisKey(tenantId: string, metric: UsageMetric, period?: string): string {
  const p = period ?? currentPeriod();
  return `usage:${tenantId}:${metric}:${p}`;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Incrementa contador no Redis. Seta TTL de 35 dias na primeira vez. */
export async function incrementUsage(
  tenantId: string,
  metric: UsageMetric,
  amount = 1,
): Promise<void> {
  const key = redisKey(tenantId, metric);
  const result = await redis.incrby(key, amount);
  if (result === amount) {
    await redis.expire(key, 60 * 60 * 24 * 35);
  }
}

/** Le o valor atual do Redis para o periodo corrente. */
export async function getCurrentUsage(
  tenantId: string,
  metric: UsageMetric,
  period?: string,
): Promise<number> {
  const key = redisKey(tenantId, metric, period);
  const val = await redis.get(key);
  return val ? parseInt(val, 10) : 0;
}

/** Flush: le Redis e persiste em usage_snapshots no Postgres. */
export async function flushUsageToDb(
  tenantId: string,
  metric: UsageMetric,
  period?: string,
): Promise<void> {
  const p = period ?? currentPeriod();
  const key = redisKey(tenantId, metric, p);
  const val = await redis.get(key);
  if (!val) return;

  const value = BigInt(val);
  await prisma.usageSnapshot.upsert({
    where: { tenantId_metric_period: { tenantId, metric, period: p } },
    update: { value, updatedAt: new Date() },
    create: { tenantId, metric, period: p, value },
  });

  logger.debug({ tenantId, metric, period: p, value: val }, 'usage flushed to db');
}

/** Flush de todas as metricas de todos os tenants ativos (usado pelo job diario). */
export async function flushAllTenantsUsage(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { id: true },
  });

  const period = currentPeriod();
  const metrics: UsageMetric[] = ['messages_sent', 'storage_bytes', 'active_users'];

  for (const tenant of tenants) {
    for (const metric of metrics) {
      await flushUsageToDb(tenant.id, metric, period).catch((err: unknown) =>
        logger.error({ err, tenantId: tenant.id, metric }, 'usage flush error'),
      );
    }
  }
}

export interface UsageSummary {
  period: string;
  metrics: {
    messages_sent: { used: number; limit: number };
    storage_bytes: { used: number; limit: number };
    active_users: { used: number; limit: number };
  };
}

export async function getUsageSummary(
  tenantId: string,
  plan: { maxMessages: number; maxUsers: number; maxContacts: number },
  period?: string,
): Promise<UsageSummary> {
  const p = period ?? currentPeriod();

  const [messagesSent, storageBytes, tenant] = await Promise.all([
    getCurrentUsage(tenantId, 'messages_sent', p),
    getCurrentUsage(tenantId, 'storage_bytes', p),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    }),
  ]);

  let activeUsers = 0;
  if (tenant?.schemaName) {
    const schemaRef = quoteIdent(tenant.schemaName);
    const activeUsersResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*)::bigint AS count FROM ${schemaRef}.users WHERE status = 'active'`,
    );
    activeUsers = Number(activeUsersResult[0]?.count ?? 0);
  }

  return {
    period: p,
    metrics: {
      messages_sent: { used: messagesSent, limit: plan.maxMessages },
      storage_bytes: { used: storageBytes, limit: -1 },
      active_users: { used: activeUsers, limit: plan.maxUsers },
    },
  };
}

/**
 * Verifica se o tenant ainda tem cota de mensagens disponível no mês corrente.
 * Retorna true se pode enviar, false se cota esgotada.
 * Fail-open: se Redis estiver indisponível, permite o envio e loga warning.
 * maxMessages = -1 significa ilimitado.
 */
export async function checkMessageQuota(
  tenantId: string,
  maxMessages: number,
): Promise<boolean> {
  if (maxMessages === -1) return true;
  try {
    const used = await getCurrentUsage(tenantId, 'messages_sent');
    return used < maxMessages;
  } catch (err) {
    logger.warn({ err, tenantId }, 'usage: quota check failed, fail-open');
    return true;
  }
}
