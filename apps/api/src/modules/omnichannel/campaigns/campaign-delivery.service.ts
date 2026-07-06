import { prisma } from '../../../config/database.js';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function completeCampaignIfSettled(
  schemaName: string,
  campaignId: string,
): Promise<boolean> {
  const schema = quoteIdent(schemaName);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE ${schema}.campaigns c
     SET status = 'completed',
         completed_at = COALESCE(completed_at, NOW()),
         updated_at = NOW()
     WHERE c.id = $1::uuid
       AND c.status = 'running'
       AND NOT EXISTS (
         SELECT 1
         FROM ${schema}.campaign_contacts cc
         WHERE cc.campaign_id = c.id
           AND cc.status IN ('pending', 'queued')
       )
     RETURNING c.id::text`,
    campaignId,
  );

  return Boolean(rows[0]);
}
