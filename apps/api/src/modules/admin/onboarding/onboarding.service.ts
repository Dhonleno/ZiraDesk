import { prisma } from '../../../config/database.js';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function getOnboardingStatus(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { createdAt: true, schemaName: true },
  });
  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const schemaPrefix = `${quoteIdent(tenant.schemaName)}.`;

  const [[usersRow], [channelsRow], [orgsRow], [conversationsRow]] = await Promise.all([
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM ${schemaPrefix}users`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM ${schemaPrefix}channels`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM ${schemaPrefix}organizations`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM ${schemaPrefix}conversations`),
  ]);

  const has_users         = Number(usersRow?.count ?? 0) > 1;
  const has_channels      = Number(channelsRow?.count ?? 0) > 0;
  const has_organizations = Number(orgsRow?.count ?? 0) > 0;
  const has_conversations = Number(conversationsRow?.count ?? 0) > 0;
  const completed = [true, has_users, has_channels, has_organizations, has_conversations].filter(Boolean).length;
  const createdAt = tenant.createdAt;

  return {
    has_users,
    has_channels,
    has_organizations,
    has_conversations,
    tenant_created_at: createdAt,
    completion: Math.round((completed / 5) * 100),
    is_new_tenant: Date.now() - createdAt.getTime() < 7 * 24 * 60 * 60 * 1000,
  };
}
