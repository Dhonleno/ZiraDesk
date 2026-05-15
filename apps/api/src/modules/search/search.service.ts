import { prisma } from '../../config/database.js';

interface SearchContactRow {
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
  contact_name: string | null;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function globalSearch(q: string, limit: number, schemaName: string) {
  const term = q.trim();
  if (!term) {
    return { contacts: [], tickets: [], conversations: [] };
  }
  const schemaPrefix = `${quoteIdent(schemaName)}.`;

  const contacts = await prisma.$queryRawUnsafe<SearchContactRow[]>(
    `SELECT id, name, email, phone
     FROM ${schemaPrefix}contacts
     WHERE name ILIKE '%' || $1 || '%'
        OR email ILIKE '%' || $1 || '%'
        OR phone ILIKE '%' || $1 || '%'
        OR whatsapp ILIKE '%' || $1 || '%'
     ORDER BY updated_at DESC
     LIMIT $2`,
    term,
    limit,
  );

  const conversations = await prisma.$queryRawUnsafe<SearchConversationRow[]>(
    `SELECT c.id, c.last_message, ct.name AS contact_name
     FROM ${schemaPrefix}conversations c
     LEFT JOIN ${schemaPrefix}contacts ct ON ct.id = c.contact_id
     WHERE c.last_message ILIKE '%' || $1 || '%'
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT $2`,
    term,
    limit,
  );

  let tickets: SearchTicketRow[] = [];
  try {
    tickets = await prisma.$queryRawUnsafe<SearchTicketRow[]>(
      `SELECT id, title, status
       FROM ${schemaPrefix}tickets
       WHERE title ILIKE '%' || $1 || '%'
       ORDER BY updated_at DESC
       LIMIT $2`,
      term,
      limit,
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const message = error.message.toLowerCase();
    if (
      !(message.includes('column') && message.includes('does not exist')) &&
      !(message.includes('relation') && message.includes('does not exist'))
    ) {
      throw error;
    }
  }

  return { contacts, tickets, conversations };
}
