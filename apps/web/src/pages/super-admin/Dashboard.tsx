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
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p
        className="mt-1 text-3xl font-bold tabular-nums"
        style={{ color: accent ? '#00C9A7' : '#F1F5F9' }}
      >
        {value}
      </p>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation('admin');

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'metrics'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Metrics }>('/super-admin/metrics/overview');
      return res.data.data;
    },
  });

  const maxCount = data?.tenantsByPlan.reduce((m, p) => Math.max(m, p.count), 1) ?? 1;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('superAdmin.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">Visão geral do sistema</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-800" />
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

          {/* Tenants por plano */}
          {(data?.tenantsByPlan.length ?? 0) > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-4 text-sm font-medium text-gray-400">Tenants por plano</h2>
              <div className="space-y-3">
                {data?.tenantsByPlan.map((item) => (
                  <div key={item.planName} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-gray-300">{item.planName}</span>
                    <div className="flex-1 rounded-full bg-gray-800 h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max((item.count / maxCount) * 100, 4)}%`,
                          background: '#00C9A7',
                        }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-medium text-gray-400">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Atalhos */}
      <div className="flex gap-3">
        <Link
          to="/admin/tenants"
          className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          Gerenciar Tenants →
        </Link>
        <Link
          to="/admin/plans"
          className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          Gerenciar Planos →
        </Link>
      </div>
    </div>
  );
}
