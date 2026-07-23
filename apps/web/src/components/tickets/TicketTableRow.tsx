import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Ticket } from '../../services/api';
import { TicketStatusBadge } from './TicketStatusBadge';
import { TicketPriorityBadge } from './TicketPriorityBadge';
import { getSlaInfo, type SlaInfo } from '../../utils/sla';

interface Props {
  ticket: Ticket;
  now: Date;
  onClick: () => void;
}

function formatTicketNumber(n: number): string {
  return `#${String(n).padStart(5, '0')}`;
}

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function formatRelativeDate(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// Duplica getSlaLabel (mesmo padrão já usado em Tickets.tsx/TicketDetail.tsx/TicketCard.tsx) —
// SlaInfo.label vem sempre em pt-BR fixo de utils/sla.ts; a versão traduzida é montada aqui.
function getSlaLabel(sla: SlaInfo, t: TFunction<'tickets'>): string | null {
  if (sla.status === 'none' || sla.status === 'ok' || sla.hoursRemaining === null) return null;

  if (sla.status === 'overdue') {
    const overdueHours = Math.abs(Math.floor(sla.hoursRemaining));
    if (overdueHours >= 24) {
      return t('tickets.sla.overdueDays', { count: Math.floor(overdueHours / 24) });
    }
    return t('tickets.sla.overdueHours', { count: overdueHours });
  }

  if (sla.hoursRemaining < 1) {
    return t('tickets.sla.expiresLessThanHour');
  }

  const remainingHours = Math.floor(sla.hoursRemaining);
  if (remainingHours <= 0) {
    return t('tickets.sla.expiresToday');
  }

  return t('tickets.sla.expiresHours', { count: remainingHours });
}

export function TicketTableRow({ ticket, now, onClick }: Props) {
  const { t } = useTranslation('tickets');
  const sla = getSlaInfo(ticket.due_date, ticket.status, now);
  const slaLabel = getSlaLabel(sla, t);

  return (
    <tr className="ticket-table-row" onClick={onClick}>
      <td className="ticket-table-num">{formatTicketNumber(ticket.ticket_number)}</td>
      <td className="ticket-table-title">
        <div className="ticket-table-title-text">{ticket.title}</div>
        {ticket.contact_name ? (
          <div className="ticket-table-title-sub">
            {ticket.contact_name}
            {ticket.organization_name ? ` · ${ticket.organization_name}` : ''}
          </div>
        ) : null}
      </td>
      <td><TicketStatusBadge status={ticket.status} /></td>
      <td><TicketPriorityBadge priority={ticket.priority} size="sm" /></td>
      <td>
        {ticket.assignee_name ? (
          <div className="ticket-assignee-chip" title={ticket.assignee_name}>
            {initials(ticket.assignee_name)}
          </div>
        ) : null}
      </td>
      <td className="ticket-table-date">{formatRelativeDate(ticket.updated_at)}</td>
      <td>
        {sla.status !== 'none' ? (
          <span className={`ticket-table-sla ticket-table-sla--${sla.status}`}>
            {slaLabel}
          </span>
        ) : null}
      </td>
    </tr>
  );
}
