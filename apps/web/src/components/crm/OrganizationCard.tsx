import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { CrmOrganization } from '../../services/api';
import { ContactAvatar } from './ContactAvatar';
import { OrgStatusBadge } from './ContactBadge';

interface OrganizationCardProps {
  org: CrmOrganization;
  selected: boolean;
  onClick: () => void;
}

function relativeTime(dateStr: string | null | undefined, locale: string, t: TFunction<'crm'>): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('organizations.time.now');
  if (mins < 60) return t('organizations.time.minutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('organizations.time.hoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 7) return t('organizations.time.daysAgo', { count: days });
  return new Date(dateStr).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

export function OrganizationCard({ org, selected, onClick }: OrganizationCardProps) {
  const { t, i18n } = useTranslation('crm');
  const statusLabels: Record<string, string> = {
    lead:     t('organizations.status.lead'),
    prospect: t('organizations.status.prospect'),
    client:   t('organizations.status.client'),
    inactive: t('organizations.status.inactive'),
  };

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 16px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--line)',
        background: selected ? 'rgba(0,201,167,.06)' : 'transparent',
        transition: 'background .12s',
        boxShadow: selected ? 'inset 3px 0 0 var(--teal)' : 'none',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = 'var(--bg-3)';
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <ContactAvatar id={org.id} name={org.name} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name + badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {org.name}
            </span>
            <OrgStatusBadge status={org.status} label={statusLabels[org.status] ?? org.status} />
          </div>

          {/* Contacts count + segment */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--txt-3)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <circle cx="4" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.1"/>
                <path d="M1 9c0-1.7 1.3-2.8 3-2.8s3 1.1 3 2.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                <path d="M7.5 4a1.5 1.5 0 010 3M8 7c1.1.3 1.9 1 1.9 2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
              {org.contacts_count} {t('organizations.fields.contacts')}
            </span>
            {org.segment && (
              <>
                <span style={{ color: 'var(--line-2)' }}>·</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>{org.segment}</span>
              </>
            )}
          </div>

          {/* Responsible + last contact */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {org.responsible_name ?? t('organizations.fields.notInformed')}
            </span>
            <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)', flexShrink: 0, marginLeft: 8 }}>
              {relativeTime(org.updated_at, i18n.language, t)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
