import { useTranslation } from 'react-i18next';
import type { TicketPriority } from '../../services/api';

interface Props {
  priority: TicketPriority | string;
  size?: 'sm' | 'md';
}

const PRIORITY_CONFIG: Record<string, { color: string; icon: string; pulse?: boolean }> = {
  low:    { color: 'var(--txt-3)', icon: '↓' },
  medium: { color: 'var(--blue)',  icon: '→' },
  high:   { color: 'var(--amber)', icon: '↑' },
  urgent: { color: 'var(--red)',   icon: '⚡', pulse: true },
};

const PRIORITY_KEY: Record<string, string> = {
  low:    'tickets.priority.low',
  medium: 'tickets.priority.medium',
  high:   'tickets.priority.high',
  urgent: 'tickets.priority.urgent',
};

export function TicketPriorityBadge({ priority, size = 'md' }: Props) {
  const { t } = useTranslation('tickets');
  const cfg   = PRIORITY_CONFIG[priority] ?? { color: 'var(--blue)', icon: '→' };
  const isSm  = size === 'sm';

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
      <span aria-hidden style={{ fontSize: isSm ? 11 : 13 }}>{cfg.icon}</span>
      {t(PRIORITY_KEY[priority] ?? 'tickets.priority.medium')}
    </span>
  );
}
