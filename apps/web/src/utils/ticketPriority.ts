import type { TicketPriority } from '../services/api';

export interface PriorityStyle {
  color: string;
  bgColor: string;
  pulse: boolean;
  label: string; // prefixo visual (!, ↑, →, ↓)
}

export function getPriorityStyle(
  priority: TicketPriority,
  t: (key: string) => string
): PriorityStyle {
  switch (priority) {
    case 'urgent': return {
      color: 'var(--red)',
      bgColor: 'var(--red-dim)',
      pulse: true,
      label: `! ${t('tickets.priority.urgent')}`,
    };
    case 'high': return {
      color: 'var(--amber)',
      bgColor: 'var(--amber-dim)',
      pulse: false,
      label: `↑ ${t('tickets.priority.high')}`,
    };
    case 'medium': return {
      color: 'var(--purple)',
      bgColor: 'var(--purple-dim)',
      pulse: false,
      label: `→ ${t('tickets.priority.medium')}`,
    };
    default: return {
      color: 'var(--txt-3)',
      bgColor: 'var(--bg-4)',
      pulse: false,
      label: `↓ ${t('tickets.priority.low')}`,
    };
  }
}
