import { useTranslation } from 'react-i18next';
import type { TicketStatus } from '../../services/api';

interface Props {
  status: TicketStatus | string;
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  open:        { bg: 'var(--blue-dim)',   color: 'var(--blue)'   },
  in_progress: { bg: 'var(--amber-dim)',  color: 'var(--amber)'  },
  waiting:     { bg: 'var(--purple-dim)', color: 'var(--purple)' },
  resolved:    { bg: 'var(--green-dim)',  color: 'var(--green)'  },
  closed:      { bg: 'var(--line)',       color: 'var(--txt-3)'  },
};

const STATUS_KEY: Record<string, string> = {
  open:        'tickets.status.open',
  in_progress: 'tickets.status.in_progress',
  waiting:     'tickets.status.waiting',
  resolved:    'tickets.status.resolved',
  closed:      'tickets.status.closed',
};

export function TicketStatusBadge({ status }: Props) {
  const { t } = useTranslation('tickets');
  const style = STATUS_STYLE[status] ?? { bg: 'var(--line)', color: 'var(--txt-3)' };

  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      padding:      '2px 8px',
      borderRadius: 'var(--r-pill)',
      fontSize:     11,
      fontWeight:   600,
      background:   style.bg,
      color:        style.color,
      letterSpacing: 0.2,
      whiteSpace:   'nowrap',
    }}>
      {t(STATUS_KEY[status] ?? 'tickets.status.closed')}
    </span>
  );
}
