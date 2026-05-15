import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

type TenantStatus = 'active' | 'trial' | 'suspended' | 'cancelled';

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

interface DashboardTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  trialEndsAt: string | null;
  usersCount: number;
  usersLimit: number | null;
  conversationsThisMonth: number;
  plan: {
    id: string;
    name: string;
    slug: string;
    priceMonth: string;
    maxUsers: number | null;
  } | null;
}

interface TenantsResponse {
  success: boolean;
  data: DashboardTenant[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

interface PlanOption {
  id: string;
  name: string;
  slug: string;
}

interface PlansResponse {
  success: boolean;
  data: PlanOption[];
}

interface MetricCardProps {
  label: string;
  value: number;
  accent?: boolean;
}

const statusVariant: Record<TenantStatus, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  trial: 'info',
  suspended: 'error',
  cancelled: 'neutral',
};

const avatarGradients = [
  'linear-gradient(135deg, var(--pink), var(--purple))',
  'linear-gradient(135deg, var(--blue), var(--teal))',
  'linear-gradient(135deg, var(--amber), var(--red))',
  'linear-gradient(135deg, var(--green), var(--teal))',
  'linear-gradient(135deg, var(--purple), var(--blue))',
];

function MetricCard({ label, value, accent = false }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-line bg-bg-2 p-5">
      <p className="text-xs font-medium text-txt-2">{label}</p>
      <p
        className="mt-2 text-[28px] font-semibold tabular-nums leading-none"
        style={{ color: accent ? 'var(--teal)' : 'var(--txt)' }}
      >
        {value}
      </p>
    </div>
  );
}

function initialsFromName(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '—';
  if (tokens.length === 1) return tokens[0]!.slice(0, 2).toUpperCase();
  return `${tokens[0]![0] ?? ''}${tokens[1]![0] ?? ''}`.toUpperCase();
}

function toDateInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysDiffFromToday(dateIso: string): number {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(dateIso);
  const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((targetStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
}

export function Dashboard() {
  const { t } = useTranslation('admin');
  const qc = useQueryClient();

  const [planTenant, setPlanTenant] = useState<DashboardTenant | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [trialEndsAt, setTrialEndsAt] = useState('');

  const { data: metrics, isLoading: isMetricsLoading, isError: isMetricsError } = useQuery({
    queryKey: ['super-admin', 'metrics'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Metrics }>('/super-admin/metrics/overview');
      return res.data.data;
    },
  });

  const { data: tenantsForDashboard = [], isLoading: isTenantsLoading } = useQuery({
    queryKey: ['super-admin', 'tenants', 'dashboard'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', perPage: '100' });
      const res = await api.get<TenantsResponse>(`/super-admin/tenants?${params}`);
      return res.data.data;
    },
  });

  const { data: planOptions = [] } = useQuery({
    queryKey: ['super-admin', 'plans'],
    queryFn: async () => {
      const res = await api.get<PlansResponse>('/super-admin/plans');
      return res.data.data;
    },
  });

  const maxCount = metrics?.tenantsByPlan.reduce((m, p) => Math.max(m, p.count), 1) ?? 1;

  const selectedPlan = useMemo(
    () => planOptions.find((plan) => plan.id === selectedPlanId) ?? null,
    [planOptions, selectedPlanId],
  );

  const showTrialField = selectedPlan?.slug === 'trial';

  const recentTenants = useMemo(
    () => tenantsForDashboard.slice(0, 5),
    [tenantsForDashboard],
  );

  const expiringTrials = useMemo(() => (
    tenantsForDashboard
      .filter((tenant) => tenant.status === 'trial')
      .filter((tenant) => tenant.trialEndsAt)
      .map((tenant) => ({
        tenant,
        daysLeft: daysDiffFromToday(tenant.trialEndsAt!),
      }))
      .filter((entry) => entry.daysLeft <= 7)
      .sort((a, b) => {
        const aTs = new Date(a.tenant.trialEndsAt!).getTime();
        const bTs = new Date(b.tenant.trialEndsAt!).getTime();
        return aTs - bTs;
      })
  ), [tenantsForDashboard]);

  const updatePlanMutation = useMutation({
    mutationFn: async (payload: { id: string; planId: string; trialEndsAt: string | null }) =>
      api.patch(`/super-admin/tenants/${payload.id}`, {
        planId: payload.planId,
        trialEndsAt: payload.trialEndsAt,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenants'] });
      setPlanTenant(null);
    },
  });

  const openPlanModal = (tenant: DashboardTenant) => {
    setPlanTenant(tenant);
    setSelectedPlanId(tenant.plan?.id ?? '');
    setTrialEndsAt(toDateInputValue(tenant.trialEndsAt));
  };

  const savePlanEdition = async () => {
    if (!planTenant || !selectedPlanId) return;
    await updatePlanMutation.mutateAsync({
      id: planTenant.id,
      planId: selectedPlanId,
      trialEndsAt: showTrialField ? (trialEndsAt || null) : null,
    });
  };

  const createdLabel = (createdAt: string) => {
    const days = Math.max(daysDiffFromToday(createdAt) * -1, 0);
    if (days === 0) return t('superAdmin.dashboard.createdToday');
    return t('superAdmin.dashboard.createdAgo', { count: days });
  };

  const trialExpiryLabel = (daysLeft: number) => {
    if (daysLeft < 0) {
      return {
        text: t('superAdmin.dashboard.expiredAgo', { count: Math.abs(daysLeft) }),
        color: 'var(--red)',
      };
    }

    if (daysLeft === 0) {
      return {
        text: t('superAdmin.dashboard.expiresToday'),
        color: 'var(--red)',
      };
    }

    if (daysLeft <= 3) {
      return {
        text: t('superAdmin.dashboard.expiresInDays', { count: daysLeft }),
        color: 'var(--amber)',
      };
    }

    return {
      text: t('superAdmin.dashboard.expiresInDays', { count: daysLeft }),
      color: 'var(--txt-2)',
    };
  };

  if (isMetricsError) {
    return (
      <div
        className="rounded-xl border p-6 text-center text-sm"
        style={{
          borderColor: 'var(--red)',
          background: 'var(--red-dim)',
          color: 'var(--red)',
        }}
      >
        {t('superAdmin.dashboard.metricsLoadError')}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>{t('superAdmin.title')}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>{t('superAdmin.dashboard.systemOverview')}</p>
      </div>

      {isMetricsLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-bg-3" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard label={t('superAdmin.metrics.totalTenants')} value={metrics?.totalTenants ?? 0} accent />
            <MetricCard label={t('superAdmin.metrics.activeTenants')} value={metrics?.activeTenants ?? 0} />
            <MetricCard label={t('superAdmin.metrics.trialTenants')} value={metrics?.trialTenants ?? 0} />
            <MetricCard label={t('superAdmin.metrics.suspendedTenants')} value={metrics?.suspendedTenants ?? 0} />
            <MetricCard label={t('superAdmin.metrics.newLast7Days')} value={metrics?.newTenantsLast7Days ?? 0} />
            <MetricCard label={t('superAdmin.metrics.newLast30Days')} value={metrics?.newTenantsLast30Days ?? 0} />
          </div>

          {(metrics?.tenantsByPlan.length ?? 0) > 0 && (
            <div className="rounded-xl border border-line bg-bg-2 p-5">
              <h2 className="mb-4 text-sm font-medium text-txt-2">{t('superAdmin.dashboard.tenantsByPlan')}</h2>
              <div className="space-y-3">
                {metrics?.tenantsByPlan.map((item) => (
                  <div key={item.planName} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-txt-2">{item.planName}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-4">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max((item.count / maxCount) * 100, 4)}%`,
                          background: 'var(--teal)',
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

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-line bg-bg-2 p-4">
              <header className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2
                    className="m-0 text-[10px] font-semibold uppercase"
                    style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
                  >
                    {t('superAdmin.dashboard.recentTenants')}
                  </h2>
                  <span
                    className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium"
                    style={{
                      background: 'var(--bg-3)',
                      border: '1px solid var(--line)',
                      color: 'var(--txt-2)',
                    }}
                  >
                    {recentTenants.length}
                  </span>
                </div>
                <Link to="/super-admin/tenants" className="text-xs" style={{ color: 'var(--teal)' }}>
                  {t('superAdmin.dashboard.viewAll')}
                </Link>
              </header>

              <div>
                {isTenantsLoading ? (
                  Array.from({ length: 5 }).map((_, idx) => (
                    <div
                      key={`recent-skeleton-${idx}`}
                      className="flex items-center gap-3 py-3"
                      style={{ borderBottom: idx < 4 ? '1px solid var(--line)' : 'none' }}
                    >
                      <div className="h-9 w-9 animate-pulse rounded-full" style={{ background: 'var(--bg-3)' }} />
                      <div className="flex-1 space-y-1">
                        <div className="h-3 w-40 animate-pulse rounded" style={{ background: 'var(--bg-3)' }} />
                        <div className="h-3 w-24 animate-pulse rounded" style={{ background: 'var(--bg-3)' }} />
                      </div>
                    </div>
                  ))
                ) : (
                  recentTenants.map((tenant, idx) => {
                    const gradient = avatarGradients[idx % avatarGradients.length]!;

                    return (
                      <div
                        key={tenant.id}
                        className="flex items-center justify-between gap-3 py-3"
                        style={{ borderBottom: idx < recentTenants.length - 1 ? '1px solid var(--line)' : 'none' }}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                            style={{ background: gradient, color: 'var(--on-teal)' }}
                          >
                            {initialsFromName(tenant.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-medium" style={{ color: 'var(--txt)' }}>{tenant.name}</p>
                            <p className="m-0 truncate text-xs" style={{ color: 'var(--txt-3)' }}>{tenant.slug}</p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={statusVariant[tenant.status]}>{t(`superAdmin.tenants.status.${tenant.status}`)}</Badge>
                          <span className="text-xs" style={{ color: 'var(--txt-3)' }}>{createdLabel(tenant.createdAt)}</span>
                          <Link to={`/super-admin/tenants/${tenant.id}`} className="text-xs font-medium" style={{ color: 'var(--teal)' }}>
                            {t('superAdmin.dashboard.view')}
                          </Link>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-xl border border-line bg-bg-2 p-4">
              <header className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2
                    className="m-0 text-[10px] font-semibold uppercase"
                    style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
                  >
                    {t('superAdmin.dashboard.trialsExpiring')}
                  </h2>
                  <span
                    className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium"
                    style={{
                      background: 'var(--bg-3)',
                      border: '1px solid var(--line)',
                      color: 'var(--txt-2)',
                    }}
                  >
                    {expiringTrials.length}
                  </span>
                </div>
              </header>

              {isTenantsLoading ? (
                <div className="space-y-3 py-2">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div
                      key={`trial-skeleton-${idx}`}
                      className="flex items-center justify-between gap-3 py-2"
                      style={{ borderBottom: idx < 3 ? '1px solid var(--line)' : 'none' }}
                    >
                      <div className="h-3 w-36 animate-pulse rounded" style={{ background: 'var(--bg-3)' }} />
                      <div className="h-7 w-28 animate-pulse rounded" style={{ background: 'var(--bg-3)' }} />
                    </div>
                  ))}
                </div>
              ) : expiringTrials.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <span
                    className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full"
                    style={{
                      background: 'var(--teal-dim)',
                      border: '1px solid var(--teal)',
                      color: 'var(--teal)',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M6.5 10.2 9 12.7l4.5-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <p className="m-0 text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                    {t('superAdmin.dashboard.noTrialsExpiring')}
                  </p>
                </div>
              ) : (
                <div>
                  {expiringTrials.map(({ tenant, daysLeft }, idx) => {
                    const expiry = trialExpiryLabel(daysLeft);
                    return (
                      <div
                        key={tenant.id}
                        className="flex items-center justify-between gap-3 py-3"
                        style={{ borderBottom: idx < expiringTrials.length - 1 ? '1px solid var(--line)' : 'none' }}
                      >
                        <div>
                          <p className="m-0 text-sm font-medium" style={{ color: 'var(--txt)' }}>{tenant.name}</p>
                          <p className="m-0 text-xs" style={{ color: expiry.color }}>{expiry.text}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge variant="info">{t('superAdmin.tenants.status.trial')}</Badge>
                          <Button type="button" size="sm" variant="secondary" onClick={() => openPlanModal(tenant)}>
                            {t('superAdmin.dashboard.convert')}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      <div className="flex gap-3">
        {[
          { to: '/super-admin/tenants', label: `${t('superAdmin.tenants.title')} →` },
          { to: '/super-admin/plans', label: `${t('superAdmin.plans.title')} →` },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className="rounded-lg px-4 py-2 text-sm transition-colors"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt-2)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-4)';
              e.currentTarget.style.color = 'var(--txt)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-3)';
              e.currentTarget.style.color = 'var(--txt-2)';
            }}
          >
            {label}
          </Link>
        ))}
      </div>

      <Modal
        open={!!planTenant}
        onClose={() => setPlanTenant(null)}
        title={t('superAdmin.tenants.actions.editPlan')}
        maxWidth="md"
        maxWidthPx={480}
      >
        <div className="sa-modal-grid">
          <label className="sa-modal-label" htmlFor="dashboard-plan-select">
            {t('superAdmin.tenants.fields.plan')}
          </label>
          <select
            id="dashboard-plan-select"
            className="sa-select"
            value={selectedPlanId}
            onChange={(event) => setSelectedPlanId(event.target.value)}
          >
            {planOptions.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name}</option>
            ))}
          </select>

          {showTrialField && (
            <>
              <label className="sa-modal-label" htmlFor="dashboard-trial-ends-at">
                {t('superAdmin.tenants.trialEndsAt')}
              </label>
              <input
                id="dashboard-trial-ends-at"
                type="date"
                className="sa-select"
                value={trialEndsAt}
                onChange={(event) => setTrialEndsAt(event.target.value)}
              />
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setPlanTenant(null)}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <Button type="button" onClick={() => void savePlanEdition()} loading={updatePlanMutation.isPending}>
              {t('tenantAdmin.common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
