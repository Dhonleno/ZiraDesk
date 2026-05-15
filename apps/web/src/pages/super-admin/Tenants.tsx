import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { CreateTenantModal } from '../../components/super-admin/CreateTenantModal';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';
import { useAuthStore, type AuthUser } from '../../stores/auth.store';

type TenantStatus = 'active' | 'trial' | 'suspended' | 'cancelled';

interface Tenant {
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
    maxUsers: number;
  };
}

interface TenantsResponse {
  success: boolean;
  data: Tenant[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

interface SuperAdminStatsResponse {
  success: boolean;
  data: {
    totalTenants: number;
    activeTenants: number;
    trialsExpiringSoon: number;
    estimatedMRR: number;
  };
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

interface ImpersonateResponse {
  success: boolean;
  data: {
    token: string;
    tenantSlug: string;
    tenantName: string;
  };
}

const statusVariant: Record<TenantStatus, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  trial: 'info',
  suspended: 'error',
  cancelled: 'neutral',
};

const ALL_STATUSES: Array<TenantStatus | ''> = ['', 'active', 'trial', 'suspended', 'cancelled'];

function decodeAuthUserFromToken(token: string): AuthUser | null {
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return null;
    const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const payload = JSON.parse(decoded) as {
      sub?: string;
      name?: string;
      email?: string;
      role?: string;
      tenantId?: string;
    };

    if (!payload.sub || !payload.name || !payload.email || !payload.role) return null;

    return {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      ...(payload.tenantId ? { tenantId: payload.tenantId } : {}),
    };
  } catch {
    return null;
  }
}

function formatCurrency(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale);
}

function toDateInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTrialState(trialEndsAt: string | null) {
  if (!trialEndsAt) return { variant: 'ok' as const, daysLeft: Infinity };
  const msDiff = new Date(trialEndsAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msDiff / (1000 * 60 * 60 * 24));
  if (daysLeft < 3) return { variant: 'danger' as const, daysLeft };
  if (daysLeft < 7) return { variant: 'warning' as const, daysLeft };
  return { variant: 'ok' as const, daysLeft };
}

function KpiIcon({ type }: { type: 'tenants' | 'active' | 'trial' | 'mrr' }) {
  if (type === 'tenants') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <path d="M3 5.5h12v9.5H3V5.5Z" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 8.5h6M6 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === 'active') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6.2 9 8.1 10.9 11.8 7.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === 'trial') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9 5.5v4.1l2.6 1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M3 12.5 6.5 9 9 11.5l5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 6.5H14V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Tenants() {
  const { t, i18n } = useTranslation('admin');
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setAuth = useAuthStore((state) => state.setAuth);
  const authUser = useAuthStore((state) => state.user);
  const authToken = useAuthStore((state) => state.token);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [planTenant, setPlanTenant] = useState<Tenant | null>(null);
  const [cancelTenant, setCancelTenant] = useState<Tenant | null>(null);
  const [cancelConfirmationName, setCancelConfirmationName] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [trialEndsAt, setTrialEndsAt] = useState('');

  const menuRef = useRef<HTMLDivElement | null>(null);
  const debouncedSearch = useDebounce(search, 300);
  const locale = i18n.language === 'es' ? 'es-ES' : i18n.language;

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setOpenActionsFor(null);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'tenants', { page, status, search: debouncedSearch }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), perPage: '20' });
      if (status) params.set('status', status);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await api.get<TenantsResponse>(`/super-admin/tenants?${params}`);
      return res.data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['super-admin', 'stats'],
    queryFn: async () => {
      const res = await api.get<SuperAdminStatsResponse>('/super-admin/stats');
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

  const statusMutation = useMutation({
    mutationFn: async ({ id, nextStatus }: { id: string; nextStatus: TenantStatus }) =>
      api.patch(`/super-admin/tenants/${id}`, { status: nextStatus }),
    onSuccess: (_data, { nextStatus }) => {
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenants'] });
      void qc.invalidateQueries({ queryKey: ['super-admin', 'stats'] });
      setOpenActionsFor(null);
      if (nextStatus === 'suspended') toast.success(t('superAdmin.tenants.messages.suspended'));
      if (nextStatus === 'active') toast.success(t('superAdmin.tenants.messages.activated'));
      if (nextStatus === 'cancelled') toast.success(t('superAdmin.tenants.messages.cancelled'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updatePlanMutation = useMutation({
    mutationFn: async (payload: { id: string; planId: string; trialEndsAt: string | null }) =>
      api.patch(`/super-admin/tenants/${payload.id}`, {
        planId: payload.planId,
        trialEndsAt: payload.trialEndsAt,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenants'] });
      void qc.invalidateQueries({ queryKey: ['super-admin', 'stats'] });
      setPlanTenant(null);
      toast.success(t('superAdmin.tenants.messages.updated'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const impersonateMutation = useMutation({
    mutationFn: async (tenant: Tenant) => {
      const res = await api.post<ImpersonateResponse>(`/super-admin/tenants/${tenant.id}/impersonate`);
      return { ...res.data.data, tenant };
    },
    onSuccess: ({ token, tenantSlug, tenantName }) => {
      if (!authToken || !authUser) {
        toast.error(t('tenantAdmin.common.errorSave'));
        return;
      }

      const impersonatedUser = decodeAuthUserFromToken(token);
      if (!impersonatedUser) {
        toast.error(t('tenantAdmin.common.errorSave'));
        return;
      }

      sessionStorage.setItem('superadmin_token', authToken);
      sessionStorage.setItem('superadmin_user', JSON.stringify(authUser));
      sessionStorage.setItem('impersonated_tenant_slug', tenantSlug);
      sessionStorage.setItem('impersonated_tenant_name', tenantName);

      setAuth({ user: impersonatedUser, token });

      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocalHost) {
        navigate('/omnichannel', { replace: true });
        return;
      }

      window.location.assign(`https://${tenantSlug}.ziradesk.com.br/omnichannel`);
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const statusLabel: Record<TenantStatus | '', string> = {
    '': t('tenantAdmin.common.all'),
    active: t('superAdmin.tenants.status.active'),
    trial: t('superAdmin.tenants.status.trial'),
    suspended: t('superAdmin.tenants.status.suspended'),
    cancelled: t('superAdmin.tenants.status.cancelled'),
  };

  const selectedPlan = useMemo(
    () => planOptions.find((plan) => plan.id === selectedPlanId) ?? null,
    [planOptions, selectedPlanId],
  );

  const showTrialField = selectedPlan?.slug === 'trial';
  const canConfirmCancel = !!cancelTenant && cancelConfirmationName === cancelTenant.name;

  const startPlanEdition = (tenant: Tenant) => {
    setPlanTenant(tenant);
    setSelectedPlanId(tenant.plan.id);
    setTrialEndsAt(toDateInputValue(tenant.trialEndsAt));
    setOpenActionsFor(null);
  };

  const savePlanEdition = async () => {
    if (!planTenant || !selectedPlanId) return;
    await updatePlanMutation.mutateAsync({
      id: planTenant.id,
      planId: selectedPlanId,
      trialEndsAt: showTrialField ? (trialEndsAt || null) : null,
    });
  };

  const openCancelFlow = (tenant: Tenant) => {
    setCancelTenant(tenant);
    setCancelConfirmationName('');
    setOpenActionsFor(null);
  };

  const kpis = [
    {
      label: t('superAdmin.tenants.stats.total'),
      value: stats?.totalTenants ?? 0,
      icon: <KpiIcon type="tenants" />,
    },
    {
      label: t('superAdmin.tenants.stats.active'),
      value: stats?.activeTenants ?? 0,
      icon: <KpiIcon type="active" />,
    },
    {
      label: t('superAdmin.tenants.stats.trialsExpiring'),
      value: stats?.trialsExpiringSoon ?? 0,
      icon: <KpiIcon type="trial" />,
    },
    {
      label: t('superAdmin.tenants.stats.mrr'),
      value: formatCurrency(stats?.estimatedMRR ?? 0, locale),
      icon: <KpiIcon type="mrr" />,
      isMonetary: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--txt)' }}>
            {t('superAdmin.tenants.title')}
          </h1>
          {data?.meta && (
            <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
              {t('superAdmin.tenants.totalFound', { count: data.meta.total })}
            </p>
          )}
        </div>
        <Button onClick={() => setShowCreate(true)}>{t('superAdmin.tenants.new')}</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => (
          <div key={item.label} className="sa-kpi-card">
            <div className="sa-kpi-head">
              <span className="sa-kpi-label">{item.label}</span>
              <span className="sa-kpi-icon">{item.icon}</span>
            </div>
            <strong className={`sa-kpi-value${item.isMonetary ? ' sa-kpi-value-money' : ''}`}>
              {item.value}
            </strong>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="w-72">
          <Input
            placeholder={t('superAdmin.tenants.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {ALL_STATUSES.map((currentStatus) => (
            <button
              key={currentStatus}
              type="button"
              onClick={() => {
                setStatus(currentStatus);
                setPage(1);
              }}
              className={`sa-status-chip${status === currentStatus ? ' active' : ''}`}
            >
              {statusLabel[currentStatus]}
            </button>
          ))}
        </div>
      </div>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              {[
                t('superAdmin.tenants.fields.name'),
                t('superAdmin.tenants.fields.slug'),
                t('superAdmin.tenants.fields.plan'),
                t('superAdmin.tenants.users'),
                t('superAdmin.tenants.conversations'),
                t('superAdmin.tenants.trialEndsAt'),
                t('superAdmin.tenants.fields.status'),
                t('superAdmin.tenants.fields.createdAt'),
                t('superAdmin.tenants.fields.actions'),
              ].map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, rowIdx) => (
                  <tr key={rowIdx}>
                    {Array.from({ length: 9 }).map((__, colIdx) => (
                      <td key={`${rowIdx}-${colIdx}`}>
                        <div className="h-4 w-20 animate-pulse rounded" style={{ background: 'var(--bg-3)' }} />
                      </td>
                    ))}
                  </tr>
                ))
              : (data?.data ?? []).map((tenant) => {
                  const trialState = getTrialState(tenant.trialEndsAt);
                  const trialClass =
                    trialState.variant === 'danger'
                      ? 'danger'
                      : trialState.variant === 'warning'
                        ? 'warning'
                        : 'ok';
                  const usersLimitLabel =
                    tenant.usersLimit === null || tenant.usersLimit === Infinity || tenant.usersLimit === -1
                      ? '—'
                      : tenant.usersLimit;

                  return (
                    <tr key={tenant.id}>
                      <td className="font-medium" style={{ color: 'var(--txt)' }}>{tenant.name}</td>
                      <td className="font-mono text-xs" style={{ color: 'var(--txt-2)' }}>{tenant.slug}</td>
                      <td style={{ color: 'var(--txt-2)' }}>{tenant.plan?.name ?? '—'}</td>
                      <td className="font-mono text-xs" style={{ color: 'var(--txt-2)' }}>
                        {tenant.usersCount}/{usersLimitLabel}
                      </td>
                      <td className="font-mono text-xs" style={{ color: 'var(--txt-2)' }}>
                        {tenant.conversationsThisMonth.toLocaleString(locale)}
                      </td>
                      <td className={`font-mono text-xs sa-trial-cell ${trialClass}`}>
                        {tenant.status === 'trial' && tenant.trialEndsAt
                          ? formatDate(tenant.trialEndsAt, locale)
                          : '—'}
                      </td>
                      <td>
                        <Badge variant={statusVariant[tenant.status]}>
                          {t(`superAdmin.tenants.status.${tenant.status}`)}
                        </Badge>
                      </td>
                      <td style={{ color: 'var(--txt-3)' }}>
                        {formatDate(tenant.createdAt, locale)}
                      </td>
                      <td className="relative">
                        <div ref={openActionsFor === tenant.id ? menuRef : null}>
                          <button
                            type="button"
                            className="sa-action-trigger"
                            aria-label={t('superAdmin.tenants.fields.actions')}
                            onClick={() => setOpenActionsFor((prev) => (prev === tenant.id ? null : tenant.id))}
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                              <circle cx="8" cy="3.5" r="1.2" fill="currentColor" />
                              <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                              <circle cx="8" cy="12.5" r="1.2" fill="currentColor" />
                            </svg>
                          </button>

                          {openActionsFor === tenant.id && (
                            <div className="sa-actions-menu">
                              <button type="button" onClick={() => navigate(`/super-admin/tenants/${tenant.id}`)}>
                                {t('superAdmin.tenants.actions.viewDetails')}
                              </button>
                              <button
                                type="button"
                                onClick={() => impersonateMutation.mutate(tenant)}
                                disabled={impersonateMutation.isPending}
                              >
                                {t('superAdmin.tenants.actions.impersonate')}
                              </button>
                              <button type="button" onClick={() => startPlanEdition(tenant)}>
                                {t('superAdmin.tenants.actions.editPlan')}
                              </button>
                              <div className="sa-actions-divider" />

                              <PermissionGate role="super_admin">
                                {(tenant.status === 'suspended' || tenant.status === 'cancelled') && (
                                  <button
                                    type="button"
                                    onClick={() => statusMutation.mutate({ id: tenant.id, nextStatus: 'active' })}
                                    disabled={statusMutation.isPending}
                                  >
                                    {t('superAdmin.tenants.actions.activate')}
                                  </button>
                                )}
                              </PermissionGate>

                              <PermissionGate role="super_admin">
                                {(tenant.status === 'active' || tenant.status === 'trial') && (
                                  <button
                                    type="button"
                                    onClick={() => statusMutation.mutate({ id: tenant.id, nextStatus: 'suspended' })}
                                    disabled={statusMutation.isPending}
                                  >
                                    {t('superAdmin.tenants.actions.suspend')}
                                  </button>
                                )}
                              </PermissionGate>

                              <PermissionGate role="super_admin">
                                {tenant.status !== 'cancelled' && (
                                  <button type="button" className="danger" onClick={() => openCancelFlow(tenant)}>
                                    {t('superAdmin.tenants.actions.cancel')}
                                  </button>
                                )}
                              </PermissionGate>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>

        {!isLoading && (data?.data ?? []).length === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--txt-3)' }}>
            {t('superAdmin.tenants.empty')}
          </div>
        )}

        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex justify-end px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      <CreateTenantModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => {
          setShowCreate(false);
          void qc.invalidateQueries({ queryKey: ['super-admin', 'tenants'] });
          void qc.invalidateQueries({ queryKey: ['super-admin', 'stats'] });
        }}
      />

      <Modal
        open={!!planTenant}
        onClose={() => setPlanTenant(null)}
        title={t('superAdmin.tenants.actions.editPlan')}
        maxWidth="md"
        maxWidthPx={480}
      >
        <div className="sa-modal-grid">
          <label className="sa-modal-label" htmlFor="plan-select">
            {t('superAdmin.tenants.fields.plan')}
          </label>
          <select
            id="plan-select"
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
              <label className="sa-modal-label" htmlFor="trial-ends-at">
                {t('superAdmin.tenants.trialEndsAt')}
              </label>
              <input
                id="trial-ends-at"
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

      <Modal
        open={!!cancelTenant}
        onClose={() => setCancelTenant(null)}
        title={t('superAdmin.tenants.cancelConfirmTitle')}
        maxWidth="md"
      >
        <div className="sa-modal-grid">
          <p className="m-0 text-sm" style={{ color: 'var(--txt-2)', lineHeight: 1.6 }}>
            {t('superAdmin.tenants.cancelConfirmMsg', { name: cancelTenant?.name ?? '' })}
          </p>
          <p className="m-0 text-xs" style={{ color: 'var(--txt-3)' }}>
            {t('superAdmin.tenants.cancelConfirmFullMessage', { name: cancelTenant?.name ?? '' })}
          </p>

          <Input
            value={cancelConfirmationName}
            onChange={(event) => setCancelConfirmationName(event.target.value)}
            placeholder={t('superAdmin.tenants.cancelConfirmPlaceholder', { name: cancelTenant?.name ?? '' })}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCancelTenant(null)}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <PermissionGate role="super_admin">
              <Button
                type="button"
                variant="danger"
                disabled={!canConfirmCancel}
                loading={statusMutation.isPending}
                onClick={() => {
                  if (!cancelTenant) return;
                  statusMutation.mutate({ id: cancelTenant.id, nextStatus: 'cancelled' });
                  setCancelTenant(null);
                }}
              >
                {t('superAdmin.tenants.actions.cancel')}
              </Button>
            </PermissionGate>
          </div>
        </div>
      </Modal>
    </div>
  );
}
