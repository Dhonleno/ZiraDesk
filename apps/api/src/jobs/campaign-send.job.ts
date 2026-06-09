import { Worker } from 'bullmq';
import { bullmqConnection } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { decryptCredentials } from '../utils/crypto.js';
import { messageQueue } from './queue.js';
import { buildTemplateComponentsForCampaign } from './campaign-template-components.js';
import { isPublicTestTemplate } from './message-delivery-policy.js';
import { completeCampaignIfSettled } from '../modules/omnichannel/campaigns/campaign-delivery.service.js';
import { closeFailedInitialOutbound } from '../modules/omnichannel/outbound-failure.service.js';

interface CampaignSendJobData {
  campaignId: string;
  tenantId: string;
  schemaName: string;
}

interface CampaignRow {
  id: string;
  status: string;
  channel_id: string | null;
  template_id: string | null;
  template_variables: unknown;
  template_header_media_url: string | null;
  template_header_media_filename: string | null;
  daily_limit: number;
  sent_count: number;
}

interface ChannelRow {
  id: string;
  type: string;
  status: string;
  credentials: string | object | null;
}

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  status: string;
  meta_template_id: string | null;
  body: string | null;
  header_type: string | null;
}

interface PendingContactRow {
  cc_id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const campaignSendWorker = new Worker<CampaignSendJobData>(
  'ziradesk-campaign-send',
  async (job) => {
    const { campaignId, tenantId, schemaName } = job.data;
    const schema = quoteIdent(schemaName);
    logger.info({ campaignId, tenantId }, '[CampaignSend] Starting campaign send job');

    // Fetch campaign
    const campaignRows = await prisma.$queryRawUnsafe<CampaignRow[]>(
      `SELECT id::text, status, channel_id::text, template_id::text,
              template_variables, template_header_media_url, template_header_media_filename,
              daily_limit, sent_count
       FROM ${schema}.campaigns
       WHERE id = $1::uuid
       LIMIT 1`,
      campaignId,
    );
    const campaign = campaignRows[0];
    if (!campaign) {
      logger.warn({ campaignId }, '[CampaignSend] Campaign not found, aborting');
      return;
    }
    if (campaign.status !== 'running') {
      logger.info({ campaignId, status: campaign.status }, '[CampaignSend] Campaign not running, aborting');
      return;
    }
    if (!campaign.channel_id || !campaign.template_id) {
      logger.warn({ campaignId }, '[CampaignSend] Campaign missing channel or template, marking cancelled');
      await prisma.$executeRawUnsafe(
        `UPDATE ${schema}.campaigns SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1::uuid`,
        campaignId,
      );
      return;
    }

    // Fetch channel and credentials
    const channelRows = await prisma.$queryRawUnsafe<ChannelRow[]>(
      `SELECT id::text, type, status, credentials FROM ${schema}.channels WHERE id = $1::uuid LIMIT 1`,
      campaign.channel_id,
    );
    const channel = channelRows[0];
    if (!channel || channel.type !== 'whatsapp' || channel.status !== 'active') {
      logger.warn({ campaignId, channelId: campaign.channel_id }, '[CampaignSend] Channel unavailable');
      await prisma.$executeRawUnsafe(
        `UPDATE ${schema}.campaigns SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1::uuid`,
        campaignId,
      );
      return;
    }
    const channelCredentials = channel.credentials ? decryptCredentials(channel.credentials) : {};

    // Fetch template
    const templateRows = await prisma.$queryRawUnsafe<TemplateRow[]>(
      `SELECT id::text, name, language, status, meta_template_id, body, header_type
       FROM ${schema}.whatsapp_templates
       WHERE id = $1::uuid LIMIT 1`,
      campaign.template_id,
    ).catch(() => [] as TemplateRow[]);
    const template = templateRows[0];
    if (!template || template.status !== 'approved' || !template.meta_template_id) {
      logger.warn({ campaignId, templateId: campaign.template_id }, '[CampaignSend] Template unavailable');
      await prisma.$executeRawUnsafe(
        `UPDATE ${schema}.campaigns SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1::uuid`,
        campaignId,
      );
      return;
    }
    if (isPublicTestTemplate(template.name)) {
      logger.warn({ campaignId, templateId: campaign.template_id }, '[CampaignSend] Public test template blocked');
      await prisma.$executeRawUnsafe(
        `UPDATE ${schema}.campaigns SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1::uuid`,
        campaignId,
      );
      return;
    }

    const BATCH_SIZE = 10;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check campaign status before each batch
      const statusCheck = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status FROM ${schema}.campaigns WHERE id = $1::uuid LIMIT 1`,
        campaignId,
      );
      const currentStatus = statusCheck[0]?.status;
      if (currentStatus !== 'running') {
        logger.info({ campaignId, status: currentStatus }, '[CampaignSend] Campaign paused or cancelled, stopping');
        break;
      }

      // Check daily limit
      const sentTodayRows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
         FROM ${schema}.campaign_contacts
         WHERE campaign_id = $1::uuid
           AND (
             status = 'queued'
             OR (
               sent_at >= CURRENT_DATE
               AND sent_at < CURRENT_DATE + INTERVAL '1 day'
             )
           )`,
        campaignId,
      );
      const sentToday = parseInt(sentTodayRows[0]?.count ?? '0', 10);
      const remainingToday = campaign.daily_limit - sentToday;

      if (remainingToday <= 0) {
        logger.info({ campaignId, sentToday, dailyLimit: campaign.daily_limit }, '[CampaignSend] Daily limit reached, stopping for today');
        break;
      }

      const batchLimit = Math.min(BATCH_SIZE, remainingToday);

      // Fetch pending contacts (excluding opted-out contacts)
      const pendingContacts = await prisma.$queryRawUnsafe<PendingContactRow[]>(
        `SELECT
           cc.id::text AS cc_id,
           cc.contact_id::text AS contact_id,
           ct.name AS contact_name,
           ct.email AS contact_email,
           ct.phone AS contact_phone,
           ct.whatsapp AS contact_whatsapp
         FROM ${schema}.campaign_contacts cc
         JOIN ${schema}.contacts ct ON ct.id = cc.contact_id
         WHERE cc.campaign_id = $1::uuid
           AND cc.status = 'pending'
           AND ct.id NOT IN (
             SELECT contact_id FROM ${schema}.campaign_optouts WHERE contact_id IS NOT NULL
           )
         ORDER BY cc.created_at ASC
         LIMIT $2::integer`,
        campaignId,
        batchLimit,
      );

      if (pendingContacts.length === 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE ${schema}.campaign_contacts cc
           SET status = 'opted_out'
           WHERE cc.campaign_id = $1::uuid
             AND cc.status = 'pending'
             AND EXISTS (
               SELECT 1
               FROM ${schema}.campaign_optouts optout
               WHERE optout.contact_id = cc.contact_id
             )`,
          campaignId,
        );
        const completed = await completeCampaignIfSettled(schemaName, campaignId);
        logger.info(
          { campaignId, completed },
          completed
            ? '[CampaignSend] All contacts processed, campaign completed'
            : '[CampaignSend] Dispatch queued, waiting for delivery results',
        );
        break;
      }

      for (const cc of pendingContacts) {
        let conversationId: string | null = null;
        let messageDbId: string | null = null;
        try {
          const phone = (cc.contact_whatsapp ?? cc.contact_phone ?? '').replace(/\D/g, '');
          if (!phone) {
            await prisma.$executeRawUnsafe(
              `UPDATE ${schema}.campaign_contacts
               SET status = 'failed', error_message = 'Sem telefone', failed_at = NOW()
               WHERE id = $1::uuid`,
              cc.cc_id,
            );
            await prisma.$executeRawUnsafe(
              `UPDATE ${schema}.campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1::uuid`,
              campaignId,
            );
            continue;
          }

          const contactData = {
            name: cc.contact_name,
            phone: cc.contact_whatsapp ?? cc.contact_phone ?? '',
            email: cc.contact_email,
          };
          const templateComponents = buildTemplateComponentsForCampaign(template, campaign, contactData);

          // Create conversation for this contact
          const convRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
            `INSERT INTO ${schema}.conversations
               (contact_id, channel_id, channel_type, conversation_type, status, metadata)
             VALUES ($1::uuid, $2::uuid, 'whatsapp', 'outbound', 'waiting', $3::jsonb)
             RETURNING id`,
            cc.contact_id,
            campaign.channel_id,
            JSON.stringify({ campaign_id: campaignId, campaign_contact_id: cc.cc_id }),
          );
          conversationId = convRows[0]?.id ?? null;
          if (!conversationId) {
            throw new Error('Falha ao criar conversa para campanha');
          }

          // Insert initial message
          const msgRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
            `INSERT INTO ${schema}.messages
               (conversation_id, sender_type, content, content_type, metadata)
             VALUES ($1::uuid, 'agent', $2, 'template', $3::jsonb)
             RETURNING id`,
            conversationId,
            template.name,
            JSON.stringify({
              whatsapp_template: {
                name: template.name,
                language: template.language,
                components: templateComponents,
              },
              campaign_id: campaignId,
            }),
          );
          messageDbId = msgRows[0]?.id ?? null;
          if (!messageDbId) throw new Error('Falha ao inserir mensagem de campanha');

          await prisma.$executeRawUnsafe(
            `UPDATE ${schema}.conversations
             SET last_message = $1, last_message_at = NOW()
             WHERE id = $2::uuid`,
            `[Template: ${template.name}]`,
            conversationId,
          );

          // Mark as queued before publishing to avoid a race with the message worker.
          await prisma.$executeRawUnsafe(
            `UPDATE ${schema}.campaign_contacts
             SET status = 'queued', conversation_id = $1::uuid
             WHERE id = $2::uuid`,
            conversationId,
            cc.cc_id,
          );

          await messageQueue.add('send', {
            messageId: messageDbId,
            conversationId,
            tenantId,
            tenantSchema: schemaName,
            channelType: 'whatsapp',
            channelCredentials,
            content: template.body ?? '',
            to: phone,
            templateName: template.name,
            templateLanguage: template.language,
            templateComponents: templateComponents.length > 0 ? templateComponents : null,
          });

          logger.info({ campaignId, contactId: cc.contact_id, conversationId }, '[CampaignSend] Contact queued');
        } catch (err) {
          logger.error({ err, campaignId, contactId: cc.contact_id }, '[CampaignSend] Failed to process contact');
          const errorMessage = err instanceof Error ? err.message.slice(0, 500) : 'Erro desconhecido';
          await prisma.$executeRawUnsafe(
            `UPDATE ${schema}.campaign_contacts
             SET status = 'failed',
                 error_message = $1,
                 failed_at = NOW()
             WHERE id = $2::uuid`,
            errorMessage,
            cc.cc_id,
          );
          if (conversationId) {
            await prisma.$executeRawUnsafe(
              `UPDATE ${schema}.messages
               SET status = 'failed',
                   metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
               WHERE conversation_id = $1::uuid`,
              conversationId,
              JSON.stringify({ campaign_queue_error: errorMessage }),
            );
            if (messageDbId) {
              await closeFailedInitialOutbound({
                schemaName,
                conversationId,
                messageId: messageDbId,
                provider: 'internal_queue',
                reason: errorMessage,
                tenantId,
              });
            }
          }
          await prisma.$executeRawUnsafe(
            `UPDATE ${schema}.campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1::uuid`,
            campaignId,
          );
        }
      }

      // Delay between batches (rate limiting: max ~10 msg/s)
      if (pendingContacts.length === BATCH_SIZE) {
        await sleep(1000);
      }
    }

    logger.info({ campaignId }, '[CampaignSend] Job completed');
  },
  {
    connection: bullmqConnection,
    concurrency: 1,
  },
);

campaignSendWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, campaignId: job?.data.campaignId, err: err instanceof Error ? err.message : String(err) },
    '[CampaignSend] Job failed',
  );
});

campaignSendWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, campaignId: job.data.campaignId }, '[CampaignSend] Job completed');
});

export { campaignSendWorker };
