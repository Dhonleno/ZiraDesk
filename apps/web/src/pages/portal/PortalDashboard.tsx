import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { PortalTicketList } from '../../components/portal/PortalTicketList';
import { PortalTicketDetailInline } from '../../components/portal/PortalTicketDetailInline';
import { PortalEmptyDetail } from '../../components/portal/PortalEmptyDetail';

export function PortalDashboard() {
  const { t } = useTranslation('portal');
  const navigate = useNavigate();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ['portal-tickets', 'dashboard'],
    queryFn: () => portalApi.getTickets({ per_page: 100 }),
  });

  const ticketDetailQuery = useQuery({
    queryKey: ['portal-ticket', selectedTicketId],
    queryFn: () => portalApi.getTicket(selectedTicketId!),
    enabled: !!selectedTicketId,
  });

  const tickets = ticketsQuery.data?.data ?? [];
  const inProgress = tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'in_progress').length;
  const waiting = tickets.filter((ticket) => ticket.status === 'waiting' || ticket.status === 'queued').length;
  const resolved = tickets.filter((ticket) => ticket.status === 'resolved' || ticket.status === 'closed').length;
  const total = tickets.length || 1;

  return (
    <div className="portal-page">
      <div className="portal-two-col">
        <div className="portal-col-list">
          <div className="portal-kpi-grid">
            <div className="portal-kpi">
              <div className="portal-kpi-n">{inProgress}</div>
              <div className="portal-kpi-l">{t('dashboard.kpiInProgress')}</div>
              <div className="portal-kpi-bar">
                <div className="portal-kpi-bar-fill" style={{ width: `${(inProgress / total) * 100}%`, background: 'var(--teal)' }} />
              </div>
            </div>
            <div className="portal-kpi">
              <div className="portal-kpi-n">{waiting}</div>
              <div className="portal-kpi-l">{t('dashboard.kpiWaiting')}</div>
              <div className="portal-kpi-bar">
                <div className="portal-kpi-bar-fill" style={{ width: `${(waiting / total) * 100}%`, background: 'var(--amber)' }} />
              </div>
            </div>
            <div className="portal-kpi">
              <div className="portal-kpi-n">{resolved}</div>
              <div className="portal-kpi-l">{t('dashboard.kpiResolved')}</div>
              <div className="portal-kpi-bar">
                <div className="portal-kpi-bar-fill" style={{ width: `${(resolved / total) * 100}%`, background: 'var(--green)' }} />
              </div>
            </div>
          </div>

          <div className="portal-list-header">
            <span className="portal-section-title">{t('tickets.recent')}</span>
            <button type="button" className="portal-btn-primary portal-btn-inline" onClick={() => navigate('/portal/tickets/new')}>
              {t('dashboard.newTicket')}
            </button>
          </div>

          <PortalTicketList tickets={tickets} selectedId={selectedTicketId} onSelect={setSelectedTicketId} />
        </div>

        <div className="portal-col-detail">
          {selectedTicketId && ticketDetailQuery.data ? (
            <PortalTicketDetailInline key={ticketDetailQuery.data.id} ticket={ticketDetailQuery.data} />
          ) : (
            <PortalEmptyDetail />
          )}
        </div>
      </div>
    </div>
  );
}
