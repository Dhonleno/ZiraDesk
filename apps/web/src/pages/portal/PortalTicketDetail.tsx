import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { PortalTicketDetailInline } from '../../components/portal/PortalTicketDetailInline';

export function PortalTicketDetail() {
  const { t } = useTranslation('portal');
  const { id } = useParams<{ id: string }>();

  const { data: ticket, isLoading, isError, refetch } = useQuery({
    queryKey: ['portal-ticket', id],
    queryFn: () => portalApi.getTicket(id!),
    enabled: !!id,
  });

  return (
    <div className="portal-page portal-page-narrow">
      <Link to="/portal/dashboard" className="portal-back-link">← {t('ticket.backToTickets')}</Link>

      {isLoading ? (
        <p className="portal-empty">{t('ticket.loading')}</p>
      ) : isError || !ticket ? (
        <div className="portal-empty-state">
          <div className="portal-empty-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 8v5M12 16h.01M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="portal-empty-title">{t('ticket.errorTitle')}</p>
          <p className="portal-empty-subtitle">{t('ticket.errorSubtitle')}</p>
          <button type="button" className="portal-btn-primary portal-btn-inline" onClick={() => void refetch()}>
            {t('ticket.retry')}
          </button>
        </div>
      ) : (
        <PortalTicketDetailInline ticket={ticket} />
      )}
    </div>
  );
}
