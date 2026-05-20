export type SlaStatus = 'ok' | 'warning' | 'overdue' | 'none';

export interface SlaInfo {
  status: SlaStatus;
  hoursRemaining: number | null;
  label: string | null;
}

export function getSlaInfo(
  dueDate: string | null | undefined,
  ticketStatus: string,
  now: Date = new Date(),
): SlaInfo {
  if (!dueDate || ticketStatus === 'resolved' || ticketStatus === 'closed') {
    return { status: 'none', hoursRemaining: null, label: null };
  }

  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) {
    return { status: 'none', hoursRemaining: null, label: null };
  }

  const diffMs = due.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 0) {
    const overdueHours = Math.abs(Math.floor(diffHours));
    const label = overdueHours < 24
      ? `Vencido há ${overdueHours}h`
      : `Vencido há ${Math.floor(overdueHours / 24)}d`;
    return { status: 'overdue', hoursRemaining: diffHours, label };
  }

  if (diffHours <= 24) {
    const label = diffHours < 1
      ? 'Vence em menos de 1h'
      : `Vence em ${Math.floor(diffHours)}h`;
    return { status: 'warning', hoursRemaining: diffHours, label };
  }

  return { status: 'ok', hoursRemaining: diffHours, label: null };
}

export function getSlaColor(status: SlaStatus): string {
  switch (status) {
    case 'overdue':
      return 'var(--red)';
    case 'warning':
      return 'var(--amber)';
    default:
      return 'var(--txt-3)';
  }
}

export function getSlaBg(status: SlaStatus): string {
  switch (status) {
    case 'overdue':
      return 'var(--red-dim)';
    case 'warning':
      return 'var(--amber-dim)';
    default:
      return 'transparent';
  }
}
