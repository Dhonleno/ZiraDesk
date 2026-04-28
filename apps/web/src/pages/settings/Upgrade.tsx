import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, api } from '../../services/api';
import { Skeleton } from '../../components/ui/Skeleton';

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
}

function formatPrice(value: string | number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

function formatLimit(value: number) {
  return value === -1 ? 'Ilimitado' : value.toLocaleString('pt-BR');
}

function featureList(plan: Plan) {
  const enabled = Object.entries(plan.features ?? {})
    .filter(([, value]) => value === true)
    .map(([key]) => key.replace(/_/g, ' '));

  if (enabled.length > 0) return enabled;
  return [
    `${formatLimit(plan.maxUsers)} usuários`,
    `${formatLimit(plan.maxContacts)} contatos`,
    'CRM, tickets e omnichannel',
  ];
}

export function Upgrade() {
  const [annual, setAnnual] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['public', 'plans'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Plan[] }>('/super-admin/plans');
      return res.data.data.filter((plan) => plan.isActive);
    },
  });

  const discount = useMemo(() => {
    const plan = plans[0];
    if (!plan) return 0;
    const monthlyYear = Number(plan.priceMonth) * 12;
    if (!monthlyYear) return 0;
    return Math.round((1 - Number(plan.priceYear) / monthlyYear) * 100);
  }, [plans]);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 28 }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--txt)', marginBottom: 6 }}>Escolha o plano ideal para sua equipe</h1>
            <p style={{ color: 'var(--txt-2)', fontSize: 14 }}>Evolua o ZiraDesk conforme seu atendimento cresce.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: 4 }}>
            <button onClick={() => setAnnual(false)} style={{ border: 'none', borderRadius: 'var(--r-pill)', padding: '7px 12px', background: !annual ? 'var(--teal)' : 'transparent', color: !annual ? 'var(--on-teal)' : 'var(--txt-2)', fontWeight: 700, cursor: 'pointer' }}>Mensal</button>
            <button onClick={() => setAnnual(true)} style={{ border: 'none', borderRadius: 'var(--r-pill)', padding: '7px 12px', background: annual ? 'var(--teal)' : 'transparent', color: annual ? 'var(--on-teal)' : 'var(--txt-2)', fontWeight: 700, cursor: 'pointer' }}>Anual {discount > 0 ? `-${discount}%` : ''}</button>
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} style={{ height: 360, borderRadius: 12 }} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
            {plans.slice(0, 3).map((plan) => {
              const current = settings?.plan?.id === plan.id || settings?.plan?.slug === plan.slug;
              const price = annual ? Number(plan.priceYear) / 12 : Number(plan.priceMonth);
              const whatsapp = `https://wa.me/5500000000000?text=${encodeURIComponent(`Olá! Quero assinar o plano ${plan.name} do ZiraDesk.`)}`;
              return (
                <div key={plan.id} style={{ position: 'relative', background: 'var(--bg-2)', border: `1px solid ${current ? 'var(--teal)' : 'var(--line)'}`, borderRadius: 'var(--r-lg)', padding: 20, display: 'flex', flexDirection: 'column', minHeight: 360 }}>
                  {current && (
                    <span style={{ position: 'absolute', top: 14, right: 14, borderRadius: 'var(--r-pill)', background: 'var(--teal-dim)', color: 'var(--teal)', border: '1px solid rgba(0,201,167,.25)', fontSize: 11, fontWeight: 700, padding: '3px 8px' }}>Plano atual</span>
                  )}
                  <h2 style={{ fontSize: 20, fontWeight: 700 }}>{plan.name}</h2>
                  <div style={{ marginTop: 16 }}>
                    <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--teal)' }}>{formatPrice(price)}</span>
                    <span style={{ color: 'var(--txt-2)' }}>/mês</span>
                  </div>
                  <p style={{ color: 'var(--txt-3)', fontSize: 12, marginTop: 4 }}>{formatPrice(plan.priceYear)}/ano</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 18 }}>
                    <div style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 10 }}>
                      <div style={{ color: 'var(--txt-3)', fontSize: 11 }}>Usuários</div>
                      <strong>{formatLimit(plan.maxUsers)}</strong>
                    </div>
                    <div style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 10 }}>
                      <div style={{ color: 'var(--txt-3)', fontSize: 11 }}>Contatos</div>
                      <strong>{formatLimit(plan.maxContacts)}</strong>
                    </div>
                  </div>
                  <ul style={{ display: 'grid', gap: 8, marginTop: 18, padding: 0, listStyle: 'none', color: 'var(--txt-2)', flex: 1 }}>
                    {featureList(plan).slice(0, 6).map((feature) => (
                      <li key={feature} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--green)' }}>✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <a href={current ? undefined : whatsapp} target="_blank" rel="noreferrer" aria-disabled={current} style={{ marginTop: 18, height: 40, borderRadius: 'var(--r)', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', background: current ? 'var(--bg-4)' : 'var(--teal)', color: current ? 'var(--txt-3)' : 'var(--on-teal)', fontWeight: 800, pointerEvents: current ? 'none' : 'auto' }}>
                    {current ? 'Seu plano atual' : 'Assinar'}
                  </a>
                </div>
              );
            })}
          </div>
        )}

        <section style={{ marginTop: 34, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 22 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Perguntas frequentes</h2>
          {[
            ['Posso mudar de plano depois?', 'Sim. Você pode solicitar upgrade ou downgrade a qualquer momento.'],
            ['O plano anual tem desconto?', 'Sim. O desconto aparece no toggle anual quando os preços anuais estiverem cadastrados.'],
            ['O que acontece ao atingir o limite?', 'O sistema avisa antes do bloqueio e orienta o upgrade do plano.'],
            ['Como funciona o Enterprise?', 'O Enterprise é ajustado com limites e suporte conforme a operação da sua equipe.'],
          ].map(([question, answer]) => (
            <div key={question} style={{ padding: '12px 0', borderTop: '1px solid var(--line)' }}>
              <strong>{question}</strong>
              <p style={{ color: 'var(--txt-2)', marginTop: 3 }}>{answer}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
