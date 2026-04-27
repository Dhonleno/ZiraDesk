import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../services/api';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}

function StatCard({ label, value, icon, accent = 'var(--teal)' }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-5 flex items-start gap-4"
      style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${accent}1A`, color: accent }}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--txt-2)' }}>{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums leading-none" style={{ color: 'var(--txt)' }}>
          {value}
        </p>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation('admin');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'stats', 'overview'],
    queryFn: adminApi.getStats,
  });

  if (isError) {
    return (
      <div className="p-6">
        <div
          className="rounded-xl p-6 text-center text-sm"
          style={{
            background: 'var(--red-dim)',
            border: '1px solid rgba(248,113,113,.25)',
            color: 'var(--red)',
          }}
        >
          {t('tenantAdmin.common.errorLoad')}
        </div>
      </div>
    );
  }

  const stats: StatCardProps[] = [
    {
      label: t('tenantAdmin.dashboard.stats.users'),
      value: data?.total_users ?? 0,
      accent: 'var(--teal)',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: t('tenantAdmin.dashboard.stats.clients'),
      value: data?.total_clients ?? 0,
      accent: 'var(--blue)',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: t('tenantAdmin.dashboard.stats.openConversations'),
      value: data?.open_conversations ?? 0,
      accent: 'var(--purple)',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: t('tenantAdmin.dashboard.stats.openTickets'),
      value: data?.open_tickets ?? 0,
      accent: 'var(--amber)',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
          {t('tenantAdmin.dashboard.title')}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
          {t('tenantAdmin.dashboard.subtitle')}
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-bg-3" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
      )}

      {!isLoading && (
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
        >
          <h2 className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.dashboard.summary')}
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-4 text-center">
            {[
              { label: t('tenantAdmin.dashboard.stats.totalConversations'), value: data?.total_conversations ?? 0 },
              { label: t('tenantAdmin.dashboard.stats.totalTickets'), value: data?.total_tickets ?? 0 },
              { label: t('tenantAdmin.dashboard.stats.totalMessages'), value: data?.total_messages ?? 0 },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xl font-semibold tabular-nums" style={{ color: 'var(--txt)' }}>
                  {item.value}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--txt-3)' }}>{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
