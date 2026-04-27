import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { CreateTenantModal } from '../../components/super-admin/CreateTenantModal';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';

type TenantStatus = 'active' | 'trial' | 'suspended' | 'cancelled';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  plan: { name: string };
}

interface TenantsResponse {
  success: boolean;
  data: Tenant[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

const statusVariant: Record<TenantStatus, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  trial: 'info',
  suspended: 'error',
  cancelled: 'neutral',
};

const ALL_STATUSES: Array<TenantStatus | ''> = ['', 'active', 'trial', 'suspended', 'cancelled'];

export function Tenants() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

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

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'suspend' | 'activate' }) =>
      api.post(`/super-admin/tenants/${id}/${action}`),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenants'] });
      toast.success(
        vars.action === 'suspend'
          ? t('superAdmin.tenants.messages.suspended')
          : t('superAdmin.tenants.messages.activated'),
      );
    },
    onError: () => toast.error('Erro ao executar ação'),
  });

  const statusLabel: Record<TenantStatus | '', string> = {
    '': 'Todos',
    active: t('superAdmin.tenants.status.active'),
    trial: t('superAdmin.tenants.status.trial'),
    suspended: t('superAdmin.tenants.status.suspended'),
    cancelled: t('superAdmin.tenants.status.cancelled'),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F0F1F3' }}>
            {t('superAdmin.tenants.title')}
          </h1>
          {data?.meta && (
            <p className="mt-1 text-sm" style={{ color: '#9DA3AE' }}>
              {data.meta.total} tenants encontrados
            </p>
          )}
        </div>
        <Button onClick={() => setShowCreate(true)}>{t('superAdmin.tenants.new')}</Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="w-72">
          <Input
            placeholder={t('superAdmin.tenants.search')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className="text-xs font-medium transition-colors"
              style={
                status === s
                  ? {
                      background: 'rgba(0,201,167,.15)',
                      color: '#00C9A7',
                      border: '1px solid rgba(0,201,167,.2)',
                      borderRadius: 999,
                      padding: '4px 12px',
                    }
                  : {
                      background: 'transparent',
                      color: '#9DA3AE',
                      border: '1px solid transparent',
                      borderRadius: 999,
                      padding: '4px 12px',
                    }
              }
            >
              {statusLabel[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid rgba(255,255,255,.07)', background: '#141518' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#1A1C20', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
              {[
                t('superAdmin.tenants.fields.name'),
                t('superAdmin.tenants.fields.slug'),
                t('superAdmin.tenants.fields.plan'),
                t('superAdmin.tenants.fields.status'),
                t('superAdmin.tenants.fields.createdAt'),
                'Ações',
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left font-medium uppercase tracking-wide"
                  style={{ fontSize: 11, color: '#5C6370' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div
                          className="h-4 w-24 animate-pulse rounded"
                          style={{ background: '#1A1C20' }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : (data?.data ?? []).map((tenant) => (
                  <tr
                    key={tenant.id}
                    className="transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#1A1C20')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: '#F0F1F3' }}>
                      {tenant.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: '#9DA3AE' }}>
                      {tenant.slug}
                    </td>
                    <td className="px-4 py-3" style={{ color: '#9DA3AE' }}>
                      {tenant.plan?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant[tenant.status]}>
                        {t(`superAdmin.tenants.status.${tenant.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3" style={{ color: '#5C6370' }}>
                      {new Date(tenant.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/super-admin/tenants/${tenant.id}`}
                          className="text-xs transition-colors"
                          style={{ color: '#00C9A7' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#00E8C0')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '#00C9A7')}
                        >
                          {t('superAdmin.tenants.actions.view')}
                        </Link>
                        {tenant.status !== 'suspended' && tenant.status !== 'cancelled' && (
                          <button
                            onClick={() => actionMutation.mutate({ id: tenant.id, action: 'suspend' })}
                            className="text-xs transition-colors"
                            style={{ color: '#F87171' }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#FCA5A5')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#F87171')}
                          >
                            {t('superAdmin.tenants.actions.suspend')}
                          </button>
                        )}
                        {tenant.status === 'suspended' && (
                          <button
                            onClick={() => actionMutation.mutate({ id: tenant.id, action: 'activate' })}
                            className="text-xs transition-colors"
                            style={{ color: '#3ECF8E' }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#6EE7B7')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#3ECF8E')}
                          >
                            {t('superAdmin.tenants.actions.activate')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!isLoading && (data?.data ?? []).length === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: '#5C6370' }}>
            Nenhum tenant encontrado
          </div>
        )}

        {data?.meta && data.meta.totalPages > 1 && (
          <div
            className="flex justify-end px-4 py-3"
            style={{ borderTop: '1px solid rgba(255,255,255,.07)' }}
          >
            <Pagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      <CreateTenantModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => {
          setShowCreate(false);
          void qc.invalidateQueries({ queryKey: ['super-admin', 'tenants'] });
        }}
      />
    </div>
  );
}
