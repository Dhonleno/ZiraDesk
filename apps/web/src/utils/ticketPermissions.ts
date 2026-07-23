import type { AuthUser } from '../stores/auth.store';
import type { PublicTenantSettings, Ticket, TenantSettings } from '../services/api';

type TicketPermissionSettings = PublicTenantSettings | TenantSettings | null;

export function isTicketReadonly(ticket: Ticket, user: AuthUser | null): boolean {
  if (!user) return true;
  if (user.role === 'owner' || user.role === 'admin') return false;
  // Agente: readonly se não for o designado OU se não tiver aceito (não in_progress)
  if (ticket.assigned_to !== user.id) return true;
  if (ticket.status !== 'in_progress') return true;
  return false;
}

// Permissões granulares configuráveis por tenant (tenant.settings). O backend
// aplica a regra em rotas sensíveis via requireTenantPermission, e a UI consome
// GET /admin/settings/public para esconder ações de agente com a mesma fonte.
export function canDeleteTicket(user: AuthUser | null, settings: TicketPermissionSettings): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_delete_tickets ?? false;
}

export function canExportTickets(user: AuthUser | null, settings: TicketPermissionSettings): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_export_tickets ?? true;
}

export function canManageContacts(user: AuthUser | null, settings: TicketPermissionSettings): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_manage_contacts ?? true;
}

export function canViewReports(user: AuthUser | null, settings: TicketPermissionSettings): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_view_reports ?? true;
}

export function canTransferConversations(user: AuthUser | null, settings: TicketPermissionSettings): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_transfer_conversations ?? true;
}

export function canManageCampaigns(user: AuthUser | null, settings: TicketPermissionSettings): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_manage_campaigns ?? true;
}
