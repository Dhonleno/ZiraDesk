import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

interface Metrics {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  cancelledTenants: number;
  totalPlans: number;
  newTenantsLast7Days: number;
  newTenantsLast30Days: number;
  tenantsByPlan: Array<{ planName: string; count: number }>;
}

interface MetricCardProps {
  label: string;
  value: number;
  accent?: boolean;
}

function MetricCard({ label, value, accent = false }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-line bg-bg-2 p-5">
      <p className="text-xs font-medium text-txt-2">{label}</p>
      <p
        className="mt-2 text-[28px] font-semibold tabular-nums leading-none"
        style={{ color: accent ? '#00C9A7' : '#F0F1F3' }}
      >
        {value}
      </p>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation('admin');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['super-admin', 'metrics'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Metrics }>('/super-admin/metrics/overview');
      return res.data.data;
    },
  });

  const maxCount = data?.tenantsByPlan.reduce((m, p) => Math.max(m, p.count), 1) ?? 1;

  if (isError) {
    return (
      <div className="rounded-xl border border-[rgba(248,113,113,.25)] bg-[rgba(248,113,113,.08)] p-6 text-center text-sm text-[#F87171]">
        Falha ao carregar métricas. Verifique se a API está rodando e tente novamente.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#F0F1F3' }}>{t('superAdmin.title')}</h1>
        <p className="mt-1 text-sm" style={{ color: '#9DA3AE' }}>Visão geral do sistema</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-bg-3" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard label={t('superAdmin.metrics.totalTenants')} value={data?.totalTenants ?? 0} accent />
            <MetricCard label={t('superAdmin.metrics.activeTenants')} value={data?.activeTenants ?? 0} />
            <MetricCard label={t('superAdmin.metrics.trialTenants')} value={data?.trialTenants ?? 0} />
            <MetricCard label={t('superAdmin.metrics.suspendedTenants')} value={data?.suspendedTenants ?? 0} />
            <MetricCard label={t('superAdmin.metrics.newLast7Days')} value={data?.newTenantsLast7Days ?? 0} />
            <MetricCard label={t('superAdmin.metrics.newLast30Days')} value={data?.newTenantsLast30Days ?? 0} />
          </div>

          {(data?.tenantsByPlan.length ?? 0) > 0 && (
            <div className="rounded-xl border border-line bg-bg-2 p-5">
              <h2 className="mb-4 text-sm font-medium text-txt-2">Tenants por plano</h2>
              <div className="space-y-3">
                {data?.tenantsByPlan.map((item) => (
                  <div key={item.planName} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-txt-2">{item.planName}</span>
                    <div className="flex-1 h-2 rounded-full bg-bg-4 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max((item.count / maxCount) * 100, 4)}%`,
                          background: '#00C9A7',
                        }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-medium text-txt-2">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex gap-3">
        {[
          { to: '/super-admin/tenants', label: 'Gerenciar Tenants →' },
          { to: '/super-admin/plans', label: 'Gerenciar Planos →' },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className="rounded-lg px-4 py-2 text-sm transition-colors"
            style={{ background: '#1A1C20', border: '1px solid rgba(255,255,255,.07)', color: '#9DA3AE' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#22252B';
              e.currentTarget.style.color = '#F0F1F3';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#1A1C20';
              e.currentTarget.style.color = '#9DA3AE';
            }}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
