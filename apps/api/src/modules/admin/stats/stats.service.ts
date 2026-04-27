import { prisma } from '../../../config/database.js';

export async function getOverview() {
  const [
    [usersRow],
    [clientsRow],
    [totalConvRow],
    [openConvRow],
    [totalTicketsRow],
    [openTicketsRow],
    [messagesRow],
  ] = await Promise.all([
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count FROM users WHERE status = 'active'`,
    ),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM clients`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM conversations`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count FROM conversations WHERE status = 'open'`,
    ),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM tickets`),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count FROM tickets WHERE status IN ('open', 'in_progress')`,
    ),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM messages`),
  ]);

  return {
    total_users: Number(usersRow?.count ?? 0),
    total_clients: Number(clientsRow?.count ?? 0),
    total_conversations: Number(totalConvRow?.count ?? 0),
    open_conversations: Number(openConvRow?.count ?? 0),
    total_tickets: Number(totalTicketsRow?.count ?? 0),
    open_tickets: Number(openTicketsRow?.count ?? 0),
    total_messages: Number(messagesRow?.count ?? 0),
  };
}
