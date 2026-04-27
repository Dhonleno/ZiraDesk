import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../stores/toast.store';

type TenantStatus = 'active' | 'trial' | 'suspended' | 'cancelled';

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  status: TenantStatus;
  trialEndsAt: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  plan: { id: string; name: string; slug: string; priceMonth: string };
  subscriptions: Array<{
    id: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    paymentGateway: string | null;
  }>;
}

const statusVariant: Record<TenantStatus, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  trial: 'info',
  suspended: 'error',
  cancelled: 'neutral',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-800/50">
      <p className="w-40 shrink-0 text-sm text-gray-500">{label}</p>
      <p className="text-sm text-gray-200">{value}</p>
    </div>
  );
}

export function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['super-admin', 'tenant', id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: TenantDetail }>(`/super-admin/tenants/${id!}`);
      return res.data.data;
    },
    enabled: Boolean(id),
  });

  const actionMutation = useMutation({
    mutationFn: async (action: 'suspend' | 'activate') =>
      api.post(`/super-admin/tenants/${id!}/${action}`),
    onSuccess: (_data, action) => {
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenant', id] });
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenants'] });
      toast.success(
        action === 'suspend'
          ? t('superAdmin.tenants.messages.suspended')
          : t('superAdmin.tenants.messages.activated'),
      );
    },
    onError: () => toast.error('Erro ao executar ação'),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-800" />
        ))}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="text-center py-16 text-gray-500">
        Tenant não encontrado.{' '}
        <Link to="/super-admin/tenants" className="text-brand-400 hover:underline">
          Voltar
        </Link>
      </div>
    );
  }

  const sub = tenant.subscriptions[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/super-admin/tenants" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            ← Tenants
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-white">{tenant.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-sm text-gray-500">{tenant.slug}.ziradesk.com.br</span>
            <Badge variant={statusVariant[tenant.status]}>
              {t(`superAdmin.tenants.status.${tenant.status}`)}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {tenant.status !== 'suspended' && tenant.status !== 'cancelled' && (
            <Button
              variant="danger"
              size="sm"
              loading={actionMutation.isPending}
              onClick={() => actionMutation.mutate('suspend')}
            >
              {t('superAdmin.tenants.actions.suspend')}
            </Button>
          )}
          {tenant.status === 'suspended' && (
            <Button
              size="sm"
              loading={actionMutation.isPending}
              onClick={() => actionMutation.mutate('activate')}
            >
              {t('superAdmin.tenants.actions.activate')}
            </Button>
          )}
        </div>
      </div>

      {/* Info do tenant */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-1">
        <InfoRow label="ID" value={tenant.id} />
        <InfoRow label="Schema" value={tenant.schemaName} />
        <InfoRow label="Plano" value={`${tenant.plan.name} — R$ ${Number(tenant.plan.priceMonth).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês`} />
        <InfoRow label="Criado em" value={new Date(tenant.createdAt).toLocaleString('pt-BR')} />
        {tenant.trialEndsAt && (
          <InfoRow label="Trial até" value={new Date(tenant.trialEndsAt).toLocaleDateString('pt-BR')} />
        )}
      </div>

      {/* Subscription */}
      {sub && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-4 text-sm font-medium text-gray-400">Assinatura atual</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-gray-500">Status</p>
              <p className="mt-1 text-gray-200 font-medium">{sub.status}</p>
            </div>
            <div>
              <p className="text-gray-500">Período início</p>
              <p className="mt-1 text-gray-200">{new Date(sub.currentPeriodStart).toLocaleDateString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-gray-500">Período fim</p>
              <p className="mt-1 text-gray-200">{new Date(sub.currentPeriodEnd).toLocaleDateString('pt-BR')}</p>
            </div>
            {sub.paymentGateway && (
              <div>
                <p className="text-gray-500">Gateway</p>
                <p className="mt-1 text-gray-200">{sub.paymentGateway}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
