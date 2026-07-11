import type { AuthUser } from '../stores/auth.store';
import type { Ticket } from '../services/api';

export function isTicketReadonly(ticket: Ticket, user: AuthUser | null): boolean {
  if (!user) return true;
  if (user.role === 'owner' || user.role === 'admin') return false;
  // Agente: readonly se não for o designado OU se não tiver aceito (não in_progress)
  if (ticket.assigned_to !== user.id) return true;
  if (ticket.status !== 'in_progress') return true;
  return false;
}
