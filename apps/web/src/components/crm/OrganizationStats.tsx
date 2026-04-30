import { useTranslation } from 'react-i18next';
import type { CrmOrganizationStats } from '../../services/api';

interface OrganizationStatsProps {
  stats: CrmOrganizationStats | undefined;
  loading?: boolean;
}

function StatBox({ value, label }: { value: number | string; label: string }) {
  return (
    <div style={{
      background: 'var(--bg-3)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r)',
      padding: '10px 12px',
      textAlign: 'center',
      flex: 1,
    }}>
      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.5px', fontFamily: 'var(--mono)', color: 'var(--txt)' }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: 'var(--txt-3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
        {label}
      </div>
    </div>
  );
}

export function OrganizationStats({ stats, loading }: OrganizationStatsProps) {
  const { t } = useTranslation('crm');

  if (loading) {
    return (
      <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ flex: 1, height: 52, borderRadius: 'var(--r)', background: 'linear-gradient(90deg,var(--bg-3),var(--bg-5),var(--bg-3))', border: '1px solid var(--line)' }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
      <StatBox value={stats?.total_contacts ?? 0}      label={t('organizations.stats.contacts')} />
      <StatBox value={stats?.open_conversations ?? 0}  label={t('organizations.stats.openConversations')} />
      <StatBox value={stats?.open_tickets ?? 0}        label={t('organizations.stats.openTickets')} />
      <StatBox value={stats?.total_conversations ?? 0} label={t('organizations.stats.totalAttendances')} />
    </div>
  );
}
