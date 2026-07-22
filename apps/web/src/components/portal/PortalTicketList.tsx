import { useTranslation } from 'react-i18next';
import type { PortalTicket } from '../../services/api';
import { PortalStatusBadge } from './PortalStatusBadge';

function formatRelativeDate(iso: string, locale: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin}min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `há ${diffDays}d`;
  return date.toLocaleDateString(locale);
}

interface PortalTicketListProps {
  tickets: PortalTicket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PortalTicketList({ tickets, selectedId, onSelect }: PortalTicketListProps) {
  const { t, i18n } = useTranslation('portal');

  if (tickets.length === 0) {
    return (
      <div className="portal-empty-state">
        <div className="portal-empty-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 7h16M6 7l1 12h10l1-12M9 7V5h6v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
        <p className="portal-empty-title">{t('dashboard.emptyTitle')}</p>
        <p className="portal-empty-subtitle">{t('dashboard.emptySubtitle')}</p>
      </div>
    );
  }

  return (
    <div className="portal-list-rows">
      {tickets.map((ticket) => (
        <button
          key={ticket.id}
          type="button"
          className={`portal-list-row${ticket.id === selectedId ? ' selected' : ''}`}
          onClick={() => onSelect(ticket.id)}
        >
          <span className="portal-ticket-num">#{String(ticket.ticket_number).padStart(5, '0')}</span>
          <span className="portal-list-row-title">{ticket.title}</span>
          <PortalStatusBadge status={ticket.status} />
          <span className="portal-ticket-time">{formatRelativeDate(ticket.updated_at, i18n.language)}</span>
        </button>
      ))}
    </div>
  );
}
