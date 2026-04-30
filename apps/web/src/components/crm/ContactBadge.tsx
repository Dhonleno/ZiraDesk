type OrgStatus = 'lead' | 'prospect' | 'client' | 'inactive';

const STATUS_STYLES: Record<OrgStatus, { bg: string; color: string; border: string }> = {
  lead:     { bg: 'var(--amber-dim)', color: 'var(--amber)', border: 'rgba(245,158,11,.25)' },
  prospect: { bg: 'var(--blue-dim)',  color: 'var(--blue)',  border: 'rgba(96,165,250,.25)' },
  client:   { bg: 'var(--teal-dim)',  color: 'var(--teal)',  border: 'rgba(0,201,167,.25)' },
  inactive: { bg: 'var(--bg-4)',      color: 'var(--txt-3)', border: 'var(--line-2)' },
};

interface OrgStatusBadgeProps {
  status: OrgStatus;
  label: string;
}

export function OrgStatusBadge({ status, label }: OrgStatusBadgeProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.inactive;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 'var(--r-pill)',
      fontSize: 10, fontWeight: 500,
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

interface PrimaryBadgeProps {
  label: string;
}

export function PrimaryBadge({ label }: PrimaryBadgeProps) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 7px', borderRadius: 'var(--r-pill)',
      fontSize: 10, fontWeight: 600,
      background: 'var(--purple-dim)', color: 'var(--purple)',
      border: '1px solid rgba(167,139,250,.25)',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

interface StandaloneBadgeProps {
  label: string;
}

export function StandaloneBadge({ label }: StandaloneBadgeProps) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 7px', borderRadius: 'var(--r-pill)',
      fontSize: 10, fontWeight: 500,
      background: 'var(--bg-4)', color: 'var(--txt-3)',
      border: '1px solid var(--line-2)',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
