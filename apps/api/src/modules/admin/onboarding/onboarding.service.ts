import { prisma } from '../../../config/database.js';

export async function getOnboardingStatus(tenantId: string) {
  const [tenant, [usersRow], [channelsRow], [clientsRow], [conversationsRow]] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true } }),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM users`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM channels`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM clients`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM conversations`),
  ]);

  const has_users = Number(usersRow?.count ?? 0) > 1;
  const has_channels = Number(channelsRow?.count ?? 0) > 0;
  const has_clients = Number(clientsRow?.count ?? 0) > 0;
  const has_conversations = Number(conversationsRow?.count ?? 0) > 0;
  const completed = [true, has_users, has_channels, has_clients, has_conversations].filter(Boolean).length;
  const createdAt = tenant?.createdAt ?? new Date(0);

  return {
    has_users,
    has_channels,
    has_clients,
    has_conversations,
    tenant_created_at: createdAt,
    completion: Math.round((completed / 5) * 100),
    is_new_tenant: Date.now() - createdAt.getTime() < 7 * 24 * 60 * 60 * 1000,
  };
}
