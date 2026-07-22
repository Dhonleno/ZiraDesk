import { useTranslation } from 'react-i18next';
import type { TicketStatus } from '../../services/api';

const STATUS_CLASS: Record<string, string> = {
  open: 'portal-badge-open',
  in_progress: 'portal-badge-progress',
  waiting: 'portal-badge-waiting',
  resolved: 'portal-badge-resolved',
  closed: 'portal-badge-closed',
  queued: 'portal-badge-queued',
};

export function PortalStatusBadge({ status }: { status: TicketStatus | string }) {
  const { t } = useTranslation('portal');
  const className = STATUS_CLASS[status] ?? 'portal-badge-closed';

  return (
    <span className={`portal-badge ${className}`}>
      {t(`ticket.status.${status}`, { defaultValue: status })}
    </span>
  );
}
