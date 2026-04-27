import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CreatePlanModal } from '../../components/super-admin/CreatePlanModal';
import { useToast } from '../../stores/toast.store';

interface Plan {
  id: string;
  name: string;
  slug: string;
  priceMonth: string;
  priceYear: string;
  maxUsers: number;
  maxContacts: number;
  features: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

function formatPrice(value: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

function formatLimit(value: number) {
  return value === -1 ? '∞' : value.toLocaleString();
}

export function Plans() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['super-admin', 'plans'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Plan[] }>('/super-admin/plans');
      return res.data.data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (plan: Plan) =>
      api.patch(`/super-admin/plans/${plan.id}`, { isActive: !plan.isActive }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
      toast.success(t('superAdmin.plans.messages.updated'));
    },
    onError: () => toast.error('Erro ao atualizar plano'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('superAdmin.plans.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{plans.length} planos cadastrados</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>{t('superAdmin.plans.new')}</Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl bg-gray-800" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white">{plan.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{plan.slug}</p>
                </div>
                <Badge variant={plan.isActive ? 'success' : 'neutral'}>
                  {plan.isActive ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>

              <div className="space-y-1">
                <p className="text-2xl font-bold" style={{ color: '#00C9A7' }}>
                  {formatPrice(plan.priceMonth)}
                  <span className="text-sm font-normal text-gray-500">/mês</span>
                </p>
                <p className="text-sm text-gray-500">{formatPrice(plan.priceYear)}/ano</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-gray-800/50 px-3 py-2">
                  <p className="text-gray-500 text-xs">Usuários</p>
                  <p className="font-medium text-white">{formatLimit(plan.maxUsers)}</p>
                </div>
                <div className="rounded-lg bg-gray-800/50 px-3 py-2">
                  <p className="text-gray-500 text-xs">Contatos</p>
                  <p className="font-medium text-white">{formatLimit(plan.maxContacts)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {Object.entries(plan.features)
                  .filter(([, v]) => v === true)
                  .map(([k]) => (
                    <span key={k} className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                      {k}
                    </span>
                  ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                loading={toggleMutation.isPending}
                onClick={() => toggleMutation.mutate(plan)}
                className="w-full"
              >
                {plan.isActive ? 'Desativar' : 'Ativar'}
              </Button>
            </div>
          ))}
        </div>
      )}

      <CreatePlanModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => {
          setShowCreate(false);
          void qc.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
        }}
      />
    </div>
  );
}
