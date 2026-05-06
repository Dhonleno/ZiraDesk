import { useTranslation } from 'react-i18next';
import type { TicketPriority } from '../../services/api';

interface Props {
  priority: TicketPriority | string;
  size?: 'sm' | 'md';
}

const PRIORITY_CONFIG: Record<string, { color: string; pulse?: boolean }> = {
  low:    { color: 'var(--txt-3)' },
  medium: { color: 'var(--blue)' },
  high:   { color: 'var(--amber)' },
  urgent: { color: 'var(--red)', pulse: true },
};

const PRIORITY_KEY: Record<string, string> = {
  low:    'tickets.priority.low',
  medium: 'tickets.priority.medium',
  high:   'tickets.priority.high',
  urgent: 'tickets.priority.urgent',
};

export function TicketPriorityBadge({ priority, size = 'md' }: Props) {
  const { t } = useTranslation('tickets');
  const cfg   = PRIORITY_CONFIG[priority] ?? { color: 'var(--blue)' };
  const isSm  = size === 'sm';

  const icon = (() => {
    if (priority === 'low') {
      return (
        <svg width={isSm ? 11 : 13} height={isSm ? 11 : 13} viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M6 2v6.2M3.8 6.3 6 8.5l2.2-2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (priority === 'high') {
      return (
        <svg width={isSm ? 11 : 13} height={isSm ? 11 : 13} viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M6 10V3.8M3.8 5.7 6 3.5l2.2 2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (priority === 'urgent') {
      return (
        <svg width={isSm ? 11 : 13} height={isSm ? 11 : 13} viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M6.1 1.8 3 6.6h2.3L4.8 10.2 9 5.4H6.7l.5-3.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    return (
      <svg width={isSm ? 11 : 13} height={isSm ? 11 : 13} viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M2.2 6h7.6M7.8 3.8 10 6 7.8 8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  })();

  return (
    <span
      style={{
        display:     'inline-flex',
        alignItems:  'center',
        gap:         3,
        fontSize:    isSm ? 10 : 11,
        fontWeight:  600,
        color:       cfg.color,
        animation:   cfg.pulse ? 'zd-pulse 1.5s ease-in-out infinite' : undefined,
        whiteSpace:  'nowrap',
      }}
    >
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
      {t(PRIORITY_KEY[priority] ?? 'tickets.priority.medium')}
    </span>
  );
}
