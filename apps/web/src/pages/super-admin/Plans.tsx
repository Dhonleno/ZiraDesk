import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CreatePlanModal } from '../../components/super-admin/CreatePlanModal';
import { EditPlanModal } from '../../components/super-admin/EditPlanModal';
import { useToast } from '../../stores/toast.store';

interface Plan {
  id: string;
  name: string;
  slug: string;
  priceMonth: string;
  priceYear: string;
  maxUsers: number;
  maxContacts: number;
  maxMessages: number;
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
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

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
          <h1 className="text-2xl font-bold" style={{ color: '#F0F1F3' }}>
            {t('superAdmin.plans.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#9DA3AE' }}>
            {plans.length} planos cadastrados
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>{t('superAdmin.plans.new')}</Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-xl"
              style={{ background: '#1A1C20' }}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="rounded-xl p-5 space-y-4 transition-colors"
              style={{ background: '#141518', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12 }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.borderColor = 'rgba(0,201,167,.3)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.borderColor = 'rgba(255,255,255,.07)')
              }
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold" style={{ color: '#F0F1F3' }}>
                    {plan.name}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: '#5C6370' }}>
                    {plan.slug}
                  </p>
                </div>
                <Badge variant={plan.isActive ? 'success' : 'neutral'}>
                  {plan.isActive ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>

              <div className="space-y-1">
                <p className="text-[28px] font-semibold leading-none" style={{ color: '#00C9A7' }}>
                  {formatPrice(plan.priceMonth)}
                  <span className="text-sm font-normal" style={{ color: '#9DA3AE' }}>/mês</span>
                </p>
                <p className="text-sm" style={{ color: '#5C6370' }}>
                  {formatPrice(plan.priceYear)}/ano
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg px-3 py-2" style={{ background: '#1A1C20' }}>
                  <p className="text-xs" style={{ color: '#5C6370' }}>Usuários</p>
                  <p className="font-medium" style={{ color: '#F0F1F3' }}>{formatLimit(plan.maxUsers)}</p>
                </div>
                <div className="rounded-lg px-3 py-2" style={{ background: '#1A1C20' }}>
                  <p className="text-xs" style={{ color: '#5C6370' }}>Contatos</p>
                  <p className="font-medium" style={{ color: '#F0F1F3' }}>{formatLimit(plan.maxContacts)}</p>
                </div>
                <div className="col-span-2 rounded-lg px-3 py-2" style={{ background: '#1A1C20' }}>
                  <p className="text-xs" style={{ color: '#5C6370' }}>{t('superAdmin.plans.fields.maxMessages')}</p>
                  <p className="font-medium" style={{ color: '#F0F1F3' }}>{formatLimit(plan.maxMessages)}</p>
                </div>
              </div>

              {Object.entries(plan.features).filter(([, v]) => v === true).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(plan.features)
                    .filter(([, v]) => v === true)
                    .map(([k]) => (
                      <span
                        key={k}
                        style={{
                          background: '#22252B',
                          color: '#9DA3AE',
                          border: '1px solid rgba(255,255,255,.07)',
                          borderRadius: 999,
                          padding: '2px 8px',
                          fontSize: 11,
                        }}
                      >
                        {k}
                      </span>
                    ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setEditingPlan(plan)}
                  className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors"
                  style={{
                    background: 'var(--bg-3)',
                    color: 'var(--txt-3)',
                    border: '1px solid var(--line)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
                >
                  {t('superAdmin.plans.edit')}
                </button>
                <button
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(plan)}
                  className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-40"
                  style={
                    plan.isActive
                      ? {
                          background: 'rgba(248,113,113,.15)',
                          color: '#F87171',
                          border: '1px solid rgba(248,113,113,.25)',
                        }
                      : {
                          background: 'rgba(62,207,142,.15)',
                          color: '#3ECF8E',
                          border: '1px solid rgba(62,207,142,.25)',
                        }
                  }
                  onMouseEnter={(e) => {
                    if (plan.isActive) e.currentTarget.style.background = 'rgba(248,113,113,.25)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = plan.isActive
                      ? 'rgba(248,113,113,.15)'
                      : 'rgba(62,207,142,.15)';
                  }}
                >
                  {toggleMutation.isPending ? '...' : plan.isActive ? 'Desativar' : 'Ativar'}
                </button>
              </div>
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

      {editingPlan && (
        <EditPlanModal
          plan={editingPlan}
          onClose={() => setEditingPlan(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
          }}
        />
      )}
    </div>
  );
}
