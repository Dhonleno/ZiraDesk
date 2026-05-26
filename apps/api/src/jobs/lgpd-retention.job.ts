import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/database.js';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { ensureCrmInfrastructure } from '../modules/crm/crm.infrastructure.js';
import { anonymizeContactForLgpd } from '../modules/crm/contacts/contacts.service.js';
import { anonymizeOrphanConversations } from '../modules/omnichannel/conversations/conversations.lgpd.service.js';

interface LgpdRetentionJobData {}

interface TenantRow {
  id: string;
  schema_name: string;
  settings: unknown;
}

interface ContactIdRow {
  id: string;
}

const LGPD_RETENTION_QUEUE_NAME = 'ziradesk-lgpd-retention';
const LGPD_RETENTION_JOB_ID = 'lgpd-retention-daily';
const LGPD_RETENTION_EVERY_MS = 24 * 60 * 60 * 1000;
const LGPD_RETENTION_DEFAULT_DAYS = 180;
const LGPD_RETENTION_BATCH_SIZE = 100;

export const lgpdRetentionQueue = new Queue<LgpdRetentionJobData>(LGPD_RETENTION_QUEUE_NAME, {
  connection: bullmqConnection,
});

function normalizeRetentionEnabled(settings: Record<string, unknown>): boolean {
  return settings.lgpd_retention_enabled === true;
}

function normalizeRetentionDays(settings: Record<string, unknown>): number {
  const raw = settings.lgpd_retention_days;
  if (typeof raw !== 'number') return LGPD_RETENTION_DEFAULT_DAYS;
  const days = Math.trunc(raw);
  if (days < 1 || days > 3650) return LGPD_RETENTION_DEFAULT_DAYS;
  return days;
}

async function listEligibleContacts(schemaName: string, retentionDays: number): Promise<string[]> {
  const safeSchemaName = schemaName.replace(/"/g, '""');
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);
    return tx.$queryRawUnsafe<ContactIdRow[]>(
      `SELECT c.id
       FROM contacts c
       WHERE c.lgpd_anonymized_at IS NULL
         AND COALESCE(c.updated_at, c.created_at) <= NOW() - ($1::int * INTERVAL '1 day')
         AND NOT EXISTS (
           SELECT 1
           FROM conversations conv
           WHERE conv.contact_id = c.id
             AND conv.status IN ('open', 'waiting')
         )
       ORDER BY c.updated_at ASC, c.created_at ASC
       LIMIT $2`,
      retentionDays,
      LGPD_RETENTION_BATCH_SIZE,
    );
  });

  return rows.map((row) => row.id);
}

async function processTenantRetention(tenant: TenantRow): Promise<number> {
  const settings = (tenant.settings as Record<string, unknown>) ?? {};
  if (!normalizeRetentionEnabled(settings)) return 0;

  const retentionDays = normalizeRetentionDays(settings);
  let processed = 0;

  await ensureCrmInfrastructure(tenant.schema_name);

  while (true) {
    const contactIds = await listEligibleContacts(tenant.schema_name, retentionDays);
    if (!contactIds.length) break;

    for (const contactId of contactIds) {
      try {
        await anonymizeContactForLgpd(
          contactId,
          null,
          { reason: `Retenção LGPD automática (${retentionDays} dias)`, redact_messages: true },
          tenant.schema_name,
        );
        processed += 1;
      } catch (err) {
        logger.error(
          {
            tenantId: tenant.id,
            schemaName: tenant.schema_name,
            contactId,
            err: err instanceof Error ? err.message : String(err),
          },
          '[LGPD Retention] Failed to anonymize contact',
        );
      }
    }

    if (contactIds.length < LGPD_RETENTION_BATCH_SIZE) {
      break;
    }
  }

  let orphanProcessed = 0;
  try {
    orphanProcessed = await anonymizeOrphanConversations(
      tenant.schema_name,
      retentionDays,
      LGPD_RETENTION_BATCH_SIZE,
    );
    if (orphanProcessed > 0) {
      logger.info(
        { tenantId: tenant.id, schemaName: tenant.schema_name, orphanProcessed },
        '[LGPD Retention] Orphan conversations anonymized',
      );
    }
  } catch (err) {
    logger.error(
      {
        tenantId: tenant.id,
        schemaName: tenant.schema_name,
        err: err instanceof Error ? err.message : String(err),
      },
      '[LGPD Retention] Failed to anonymize orphan conversations',
    );
  }

  return processed + orphanProcessed;
}

async function runLgpdRetention(): Promise<void> {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name, settings
     FROM tenants
     WHERE status IN ('active', 'trial')`,
  );

  let totalProcessed = 0;

  for (const tenant of tenants) {
    try {
      const processed = await processTenantRetention(tenant);
      totalProcessed += processed;
      if (processed > 0) {
        logger.info(
          { tenantId: tenant.id, schemaName: tenant.schema_name, processed },
          '[LGPD Retention] Contacts anonymized',
        );
      }
    } catch (err) {
      logger.error(
        {
          tenantId: tenant.id,
          schemaName: tenant.schema_name,
          err: err instanceof Error ? err.message : String(err),
        },
        '[LGPD Retention] Failed to process tenant',
      );
    }
  }

  if (totalProcessed > 0) {
    logger.info({ totalProcessed }, '[LGPD Retention] Daily cycle completed');
  }
}

export const lgpdRetentionWorker = new Worker<LgpdRetentionJobData>(
  LGPD_RETENTION_QUEUE_NAME,
  async () => {
    await runLgpdRetention();
  },
  { connection: bullmqConnection },
);

lgpdRetentionWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, err: err instanceof Error ? err.message : String(err) },
    '[LGPD Retention] Job failed',
  );
});

void lgpdRetentionQueue.add(
  'lgpd-retention-run',
  {},
  {
    jobId: LGPD_RETENTION_JOB_ID,
    repeat: { every: LGPD_RETENTION_EVERY_MS },
    removeOnComplete: true,
    removeOnFail: true,
  },
).catch((err) => {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    '[LGPD Retention] Failed to schedule daily job',
  );
});

