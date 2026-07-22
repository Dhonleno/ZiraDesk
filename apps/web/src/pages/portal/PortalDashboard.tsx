import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { usePortalUser } from '../../hooks/usePortalUser';

export function PortalDashboard() {
  const { t, i18n } = useTranslation('portal');
  const user = usePortalUser();

  const { data: ticketsResult } = useQuery({
    queryKey: ['portal-tickets', 'dashboard'],
    queryFn: () => portalApi.getTickets({ per_page: 100 }),
  });

  const tickets = ticketsResult?.data ?? [];
  const open = tickets.filter((ticket) => ticket.status === 'open').length;
  const inProgress = tickets.filter((ticket) => ticket.status === 'in_progress').length;
  const waiting = tickets.filter((ticket) => ticket.status === 'waiting').length;
  const resolved = tickets.filter((ticket) => ticket.status === 'resolved').length;
  const closed = tickets.filter((ticket) => ticket.status === 'closed').length;

  return (
    <div className="portal-dashboard">
      <div className="portal-page-header">
        <div>
          <h2>{t('dashboard.greeting', { name: user?.name ?? t('dashboard.customerFallback') })}</h2>
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
          <span className="stat-value">{waiting}</span>
          <span className="stat-label">{t('stats.waiting')}</span>
        </div>
        <div className="portal-stat-card">
          <span className="stat-value">{resolved}</span>
          <span className="stat-label">{t('stats.resolved')}</span>
        </div>
        <div className="portal-stat-card">
          <span className="stat-value">{closed}</span>
          <span className="stat-label">{t('stats.closed')}</span>
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
                  {ticket.type_name ?? t('ticket.typeFallback')} · {new Date(ticket.created_at).toLocaleDateString(i18n.language)}
                </div>
              </div>
              <span className={`portal-status portal-status-${ticket.status}`}>
                {t(`ticket.status.${ticket.status}`, { defaultValue: ticket.status })}
              </span>
            </Link>
          ))}
          {tickets.length === 0 ? (
            <div className="portal-empty-state">
              <div className="portal-empty-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M4 7h16M6 7l1 12h10l1-12M9 7V5h6v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
              <p className="portal-empty-title">{t('dashboard.emptyTitle')}</p>
              <p className="portal-empty-subtitle">{t('dashboard.emptySubtitle')}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
