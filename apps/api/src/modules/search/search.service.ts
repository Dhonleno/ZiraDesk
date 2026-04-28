import { prisma } from '../../config/database.js';

interface SearchClientRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface SearchTicketRow {
  id: string;
  title: string;
  status: string;
}

interface SearchConversationRow {
  id: string;
  last_message: string | null;
  client_name: string | null;
}

export async function globalSearch(q: string, limit: number) {
  const term = q.trim();
  if (!term) {
    return { clients: [], tickets: [], conversations: [] };
  }

  const [clients, tickets, conversations] = await Promise.all([
    prisma.$queryRawUnsafe<SearchClientRow[]>(
      `SELECT id, name, email, phone
       FROM clients
       WHERE name ILIKE '%' || $1 || '%'
          OR email ILIKE '%' || $1 || '%'
          OR phone ILIKE '%' || $1 || '%'
       ORDER BY updated_at DESC
       LIMIT $2`,
      term,
      limit,
    ),
    prisma.$queryRawUnsafe<SearchTicketRow[]>(
      `SELECT id, title, status
       FROM tickets
       WHERE title ILIKE '%' || $1 || '%'
       ORDER BY updated_at DESC
       LIMIT $2`,
      term,
      limit,
    ),
    prisma.$queryRawUnsafe<SearchConversationRow[]>(
      `SELECT c.id, c.last_message, cl.name AS client_name
       FROM conversations c
       LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE c.last_message ILIKE '%' || $1 || '%'
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT $2`,
      term,
      limit,
    ),
  ]);

  return { clients, tickets, conversations };
}
