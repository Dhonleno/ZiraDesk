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
          <h1 className="text-2xl font-bold text-txt">{t('superAdmin.tenants.title')}</h1>
          {data?.meta && (
            <p className="mt-1 text-sm text-txt-2">{data.meta.total} tenants encontrados</p>
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
        <div className="flex gap-1 rounded-lg border border-line bg-bg-2 p-1">
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={[
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                status === s
                  ? 'bg-teal-dim text-teal'
                  : 'text-txt-2 hover:text-txt',
              ].join(' ')}
            >
              {statusLabel[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-line bg-bg-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-bg-3 text-left">
              <th className="px-4 py-3 text-xs font-medium text-txt-3">
                {t('superAdmin.tenants.fields.name')}
              </th>
              <th className="px-4 py-3 text-xs font-medium text-txt-3">
                {t('superAdmin.tenants.fields.slug')}
              </th>
              <th className="px-4 py-3 text-xs font-medium text-txt-3">
                {t('superAdmin.tenants.fields.plan')}
              </th>
              <th className="px-4 py-3 text-xs font-medium text-txt-3">
                {t('superAdmin.tenants.fields.status')}
              </th>
              <th className="px-4 py-3 text-xs font-medium text-txt-3">
                {t('superAdmin.tenants.fields.createdAt')}
              </th>
              <th className="px-4 py-3 text-xs font-medium text-txt-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-line">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-bg-3" />
                      </td>
                    ))}
                  </tr>
                ))
              : (data?.data ?? []).map((tenant) => (
                  <tr key={tenant.id} className="border-b border-line hover:bg-bg-3 transition-colors">
                    <td className="px-4 py-3 font-medium text-txt">{tenant.name}</td>
                    <td className="px-4 py-3 text-txt-2 font-mono text-xs">{tenant.slug}</td>
                    <td className="px-4 py-3 text-txt-2">{tenant.plan?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant[tenant.status]}>
                        {t(`superAdmin.tenants.status.${tenant.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-txt-3">
                      {new Date(tenant.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/super-admin/tenants/${tenant.id}`}
                          className="text-xs text-teal hover:text-teal-hover transition-colors"
                        >
                          {t('superAdmin.tenants.actions.view')}
                        </Link>
                        {tenant.status !== 'suspended' && tenant.status !== 'cancelled' && (
                          <button
                            onClick={() => actionMutation.mutate({ id: tenant.id, action: 'suspend' })}
                            className="text-xs text-[#F87171] hover:text-[#FCA5A5] transition-colors"
                          >
                            {t('superAdmin.tenants.actions.suspend')}
                          </button>
                        )}
                        {tenant.status === 'suspended' && (
                          <button
                            onClick={() => actionMutation.mutate({ id: tenant.id, action: 'activate' })}
                            className="text-xs text-[#3ECF8E] hover:text-[#6EE7B7] transition-colors"
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
          <div className="py-12 text-center text-sm text-txt-3">
            Nenhum tenant encontrado
          </div>
        )}

        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex justify-end border-t border-line px-4 py-3">
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
