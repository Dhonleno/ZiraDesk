import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { usePortalUser } from '../../hooks/usePortalUser';

export function PortalDashboard() {
  const { t } = useTranslation('portal');
  const user = usePortalUser();

  const { data: ticketsResult } = useQuery({
    queryKey: ['portal-tickets', 'dashboard'],
    queryFn: () => portalApi.getTickets({ per_page: 100 }),
  });

  const tickets = ticketsResult?.data ?? [];
  const open = tickets.filter((ticket) => ticket.status === 'open').length;
  const inProgress = tickets.filter((ticket) => ticket.status === 'in_progress').length;
  const resolved = tickets.filter((ticket) => ticket.status === 'resolved').length;

  return (
    <div className="portal-dashboard">
      <div className="portal-page-header">
        <div>
          <h2>{t('dashboard.greeting', { name: user?.name ?? 'Cliente' })}</h2>
          <p>{t('dashboard.subtitle')}</p>
        </div>
        <Link to="/portal/tickets/new" className="portal-btn-primary portal-btn-inline">
          {t('dashboard.newTicket')}
        </Link>
      </div>

      <div className="portal-stats">
        <div className="portal-stat-card">
          <span className="stat-value">{open}</span>
          <span className="stat-label">{t('stats.open')}</span>
        </div>
        <div className="portal-stat-card">
          <span className="stat-value">{inProgress}</span>
          <span className="stat-label">{t('stats.inProgress')}</span>
        </div>
        <div className="portal-stat-card">
          <span className="stat-value">{resolved}</span>
          <span className="stat-label">{t('stats.resolved')}</span>
        </div>
      </div>

      <div className="portal-section">
        <h3>{t('dashboard.recent')}</h3>
        <div className="portal-ticket-list">
          {tickets.slice(0, 5).map((ticket) => (
            <Link key={ticket.id} to={`/portal/tickets/${ticket.id}`} className="portal-ticket-row">
              <div>
                <div className="portal-ticket-title">{ticket.title}</div>
                <div className="portal-ticket-meta">
                  {ticket.type_icon ?? '🎫'} {ticket.type_name ?? 'Ticket'} · {new Date(ticket.created_at).toLocaleDateString('pt-BR')}
                </div>
              </div>
              <span className={`portal-status portal-status-${ticket.status}`}>{ticket.status}</span>
            </Link>
          ))}
          {tickets.length === 0 ? <p className="portal-empty">Nenhum ticket encontrado</p> : null}
        </div>
      </div>
    </div>
  );
}
