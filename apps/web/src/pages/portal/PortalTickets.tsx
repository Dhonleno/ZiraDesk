import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi, type TicketStatus } from '../../services/api';

const tabs: Array<{ key: TicketStatus | 'all' }> = [
  { key: 'all' },
  { key: 'open' },
  { key: 'in_progress' },
  { key: 'waiting' },
  { key: 'resolved' },
  { key: 'closed' },
];

export function PortalTickets() {
  const { t, i18n } = useTranslation('portal');
  const [status, setStatus] = useState<TicketStatus | 'all'>('all');

  const { data: result } = useQuery({
    queryKey: ['portal-tickets', status],
    queryFn: () => portalApi.getTickets(status === 'all' ? undefined : { status }),
  });

  const tickets = result?.data ?? [];

  return (
    <div className="portal-section">
      <div className="portal-page-header">
        <div>
          <h2>{t('ticket.pageTitle')}</h2>
          <p>{t('ticket.pageSubtitle')}</p>
        </div>
        <Link to="/portal/tickets/new" className="portal-btn-primary portal-btn-inline">
          {t('dashboard.newTicket')}
        </Link>
      </div>

      <div className="portal-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={status === tab.key ? 'active' : ''}
            onClick={() => setStatus(tab.key)}
          >
            {t(`ticket.tabs.${tab.key}`, { defaultValue: tab.key })}
          </button>
        ))}
      </div>

      <div className="portal-ticket-list">
        {tickets.map((ticket) => (
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
        {tickets.length === 0 ? <p className="portal-empty">{t('ticket.emptyFiltered')}</p> : null}
      </div>
    </div>
  );
}
