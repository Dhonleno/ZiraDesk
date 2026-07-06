import { Queue, Worker } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { hasFeature } from '../middleware/entitlement.js';
import { checkMessageQuota } from '../services/usage.service.js';
import { campaignSendQueue } from './queue.js';

interface ScheduledCampaignRow {
  id: string;
  kind: 'scheduled' | 'running';
}

export const campaignSchedulerQueue = new Queue('ziradesk-campaign-scheduler', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  },
});

// Register the repeatable check job — runs every 5 minutes
void campaignSchedulerQueue
  .add('check-scheduled', {}, {
    repeat: { every: 5 * 60 * 1000 },
    jobId: 'campaign-scheduler-check',
  })
  .catch((err: unknown) => {
    logger.error({ err }, '[CampaignScheduler] Failed to register repeatable job');
  });

export const campaignSchedulerWorker = new Worker(
  'ziradesk-campaign-scheduler',
  async () => {
    logger.info('[CampaignScheduler] Checking for scheduled and resumable campaigns');

    const tenants = await prisma.tenant.findMany({
      where: { status: { in: ['active', 'trial'] } },
      select: {
        id: true,
        schemaName: true,
        status: true,
        plan: { select: { features: true, maxMessages: true } },
      },
    });

    for (const tenant of tenants) {
      if (!['active', 'trial'].includes(tenant.status)) continue;

      if (!hasFeature(tenant.plan?.features as Record<string, boolean> | undefined, 'whatsapp')) {
        logger.warn({ tenantId: tenant.id }, 'campaign-scheduler: skipped — whatsapp feature not in plan');
        continue;
      }

      const maxMessages = tenant.plan?.maxMessages ?? -1;
      const withinQuota = await checkMessageQuota(tenant.id, maxMessages);
      if (!withinQuota) {
        logger.warn(
          { tenantId: tenant.id, maxMessages },
          'campaign-scheduler: skipped — monthly message quota exceeded',
        );
        continue;
      }

      const schemaName = tenant.schemaName;

      let campaigns: ScheduledCampaignRow[];
      try {
        campaigns = await prisma.$queryRawUnsafe<ScheduledCampaignRow[]>(
          `SELECT id::text, 'scheduled'::text AS kind
           FROM "${schemaName}".campaigns
           WHERE status = 'scheduled'
             AND scheduled_at IS NOT NULL
             AND scheduled_at <= NOW()

           UNION

           SELECT DISTINCT c.id::text, 'running'::text AS kind
           FROM "${schemaName}".campaigns c
           INNER JOIN "${schemaName}".campaign_contacts cc ON cc.campaign_id = c.id
           WHERE c.status = 'running'
             AND cc.status = 'pending'
             AND NOT EXISTS (
               SELECT 1
               FROM "${schemaName}".campaign_contacts cc2
               WHERE cc2.campaign_id = c.id
                 AND cc2.sent_at >= CURRENT_DATE
                 AND cc2.sent_at < CURRENT_DATE + INTERVAL '1 day'
             )
             AND NOT EXISTS (
               SELECT 1
               FROM "${schemaName}".campaign_contacts cc3
               WHERE cc3.campaign_id = c.id
                 AND cc3.status = 'queued'
             )`,
        );
      } catch {
        // Schema might not have campaigns table yet
        continue;
      }

      for (const campaign of campaigns) {
        try {
          if (campaign.kind === 'running') {
            const today = new Date().toISOString().slice(0, 10);
            await campaignSendQueue.add('send', {
              campaignId: campaign.id,
              tenantId: tenant.id,
              schemaName,
            }, { jobId: `campaign-send-${campaign.id}-resume-${today}` });

            logger.info(
              { campaignId: campaign.id, tenantId: tenant.id },
              '[CampaignScheduler] Running campaign resumed from daily limit',
            );
            continue;
          }

          const updated = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
            `UPDATE "${schemaName}".campaigns
             SET status = 'running', started_at = NOW(), updated_at = NOW()
             WHERE id = $1::uuid AND status = 'scheduled'
             RETURNING id`,
            campaign.id,
          );

          if (updated[0]) {
            await campaignSendQueue.add('send', {
              campaignId: campaign.id,
              tenantId: tenant.id,
              schemaName,
            }, { jobId: `campaign-send-${campaign.id}-${Date.now()}` });

            logger.info(
              { campaignId: campaign.id, tenantId: tenant.id },
              '[CampaignScheduler] Campaign started from schedule',
            );
          }
        } catch (err) {
          logger.error({ err, campaignId: campaign.id, tenantId: tenant.id }, '[CampaignScheduler] Failed to start campaign');
        }
      }
    }
  },
  { connection: bullmqConnection },
);

campaignSchedulerWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, '[CampaignScheduler] Job failed');
});
