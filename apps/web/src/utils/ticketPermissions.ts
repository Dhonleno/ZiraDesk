import type { AuthUser } from '../stores/auth.store';
import type { Ticket, TenantSettings } from '../services/api';

export function isTicketReadonly(ticket: Ticket, user: AuthUser | null): boolean {
  if (!user) return true;
  if (user.role === 'owner' || user.role === 'admin') return false;
  // Agente: readonly se não for o designado OU se não tiver aceito (não in_progress)
  if (ticket.assigned_to !== user.id) return true;
  if (ticket.status !== 'in_progress') return true;
  return false;
}

// Permissões granulares configuráveis por tenant (tenant.settings). O backend
// já as aplica de verdade (tickets.routes.ts/campaigns.routes.ts via
// requireTenantPermission) — estas funções existem para a UI espelhar a mesma
// regra, mas hoje GET /admin/settings só é acessível a owner/admin
// (settings.routes.ts: hasRole('owner','admin')), então para um agente
// `settings` nunca chega preenchido aqui (a request de settings 403). Até
// existir um endpoint de leitura acessível ao agente, essas funções são
// utilitárias prontas para uso, mas não há hoje um jeito confiável de um
// componente de agente obter `settings` para chamá-las corretamente.
export function canDeleteTicket(user: AuthUser | null, settings: TenantSettings | null): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_delete_tickets ?? false;
}

export function canExportTickets(user: AuthUser | null, settings: TenantSettings | null): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_export_tickets ?? true;
}

export function canManageContacts(user: AuthUser | null, settings: TenantSettings | null): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_manage_contacts ?? true;
}

export function canViewReports(user: AuthUser | null, settings: TenantSettings | null): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_view_reports ?? true;
}

export function canTransferConversations(user: AuthUser | null, settings: TenantSettings | null): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_transfer_conversations ?? true;
}

export function canManageCampaigns(user: AuthUser | null, settings: TenantSettings | null): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return settings?.agent_can_manage_campaigns ?? true;
}
