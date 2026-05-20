import type { Ticket } from '../../services/api';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { TicketStatusBadge } from './TicketStatusBadge';
import { TicketPriorityBadge } from './TicketPriorityBadge';
import { SourceBadge } from './SourceBadge';
import { getSlaColor, getSlaInfo, type SlaInfo } from '../../utils/sla';

interface Props {
  ticket:     Ticket;
  selected:   boolean;
  onClick:    () => void;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'agora';
  if (m < 60)  return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

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

function Initials({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span style={{
      width:          20, height: 20, borderRadius: '50%', background: color,
      display:        'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize:       9, fontWeight: 700, color: '#fff', flexShrink: 0,
    }}>
      {initials}
    </span>
  );
}

export function TicketCard({ ticket, selected, onClick }: Props) {
  const { t } = useTranslation('tickets');
  const [now, setNow] = useState(() => new Date());
  const sla = getSlaInfo(ticket.due_date, ticket.status, now);
  const slaLabel = getSlaLabel(sla, t);
  const dueCol = sla.status === 'warning' || sla.status === 'overdue'
    ? getSlaColor(sla.status)
    : 'var(--txt-3)';
  const ticketKey = ticket.id.slice(-6).toUpperCase();
  const ticketContactName = ticket.contact_name;
  const lastSeen = localStorage.getItem(`zd_ticket_seen_${ticket.id}`);
  const hasUnread = !lastSeen || new Date(ticket.updated_at).getTime() > new Date(lastSeen).getTime();

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        padding:      '12px 14px',
        cursor:       'pointer',
        borderBottom: '1px solid var(--line)',
        borderLeft:   selected ? '3px solid var(--teal)' : '3px solid transparent',
        background:   selected ? 'var(--bg-3)' : 'transparent',
        paddingLeft:  selected ? 11 : 14,
        transition:   'background .1s, border-color .1s',
        display:      'flex',
        flexDirection: 'column',
        gap:          6,
      }}
    >
      {/* Row 1: id + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {hasUnread ? (
          <span className="ticket-unread-dot" title="Atividade recente" aria-label="Atividade recente" />
        ) : null}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-3)', letterSpacing: 0.5 }}>
          #{ticketKey}
        </span>
        <TicketStatusBadge status={ticket.status} />
        <TicketPriorityBadge priority={ticket.priority} size="sm" />
        {ticket.type_name && ticket.type_color ? (
          <span
            className="ticket-type-badge"
            style={{
              background: `${ticket.type_color}22`,
              color: ticket.type_color,
              borderColor: `${ticket.type_color}44`,
            }}
          >
            {ticket.type_name}
          </span>
        ) : null}
        {ticket.source && ticket.source !== 'manual' ? (
          <SourceBadge source={ticket.source} />
        ) : null}
      </div>

      {/* Row 2: title */}
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--txt)', lineHeight: 1.4,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ticket.title}
      </p>

      {/* Row 3: client + assignee + date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--txt-3)' }}>
        {ticketContactName && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Initials name={ticketContactName} color="linear-gradient(135deg,var(--blue),var(--purple))" />
            <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ticketContactName}
            </span>
          </span>
        )}

        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          {ticket.assignee_name
            ? <><Initials name={ticket.assignee_name} color="linear-gradient(135deg,var(--purple),#8B5CF6)" />
                <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ticket.assignee_name}
                </span></>
            : <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>Sem responsável</span>
          }
        </span>

        <span style={{ color: 'var(--txt-3)', flexShrink: 0 }}>{formatRelative(ticket.created_at)}</span>
      </div>

      {/* Due date indicator */}
      {ticket.due_date && (
        <div style={{ fontSize: 10, color: dueCol, display: 'flex', alignItems: 'center', gap: 3 }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 3v2.5l1.5 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {new Date(ticket.due_date).toLocaleDateString('pt-BR')}
          {slaLabel ? <span style={{ fontWeight: 500 }}> · {slaLabel}</span> : null}
        </div>
      )}
    </div>
  );
}
