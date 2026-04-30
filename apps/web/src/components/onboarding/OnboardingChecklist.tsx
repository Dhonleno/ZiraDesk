import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { onboardingApi } from '../../services/api';

interface Step {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

const STORAGE_KEY = 'zd-onboarding-minimized';
const DONE_KEY = 'zd-onboarding-complete';

export function OnboardingChecklist() {
  const navigate = useNavigate();
  const [minimized, setMinimized] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');
  const [hidden, setHidden] = useState(() => localStorage.getItem(DONE_KEY) === '1');
  const [celebrate, setCelebrate] = useState(false);

  const { data } = useQuery({
    queryKey: ['admin', 'onboarding-status'],
    queryFn: onboardingApi.getStatus,
    staleTime: 60_000,
  });

  const steps = useMemo<Step[]>(() => [
    { key: 'account', label: 'Conta criada', href: '/', done: true },
    { key: 'users', label: 'Convidar primeiro usuário', href: '/admin/users', done: Boolean(data?.has_users) },
    { key: 'channels', label: 'Configurar primeiro canal', href: '/admin/channels', done: Boolean(data?.has_channels) },
    { key: 'organizations', label: 'Criar primeira organização', href: '/crm/organizations', done: Boolean(data?.has_organizations) },
    { key: 'conversations', label: 'Iniciar primeiro atendimento', href: '/omnichannel/conversations', done: Boolean(data?.has_conversations) },
  ], [data]);

  const completed = steps.filter((step) => step.done).length;
  const completion = Math.round((completed / steps.length) * 100);
  const shouldShow = Boolean(data?.is_new_tenant) && completion < 80 && !hidden;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, minimized ? '1' : '0');
  }, [minimized]);

  useEffect(() => {
    if (!data || completed < steps.length || hidden) return;
    setCelebrate(true);
    const id = window.setTimeout(() => {
      localStorage.setItem(DONE_KEY, '1');
      setHidden(true);
    }, 1600);
    return () => window.clearTimeout(id);
  }, [completed, data, hidden, steps.length]);

  if (!shouldShow && !celebrate) return null;

  if (minimized && !celebrate) {
    return (
      <button
        onClick={() => setMinimized(false)}
        style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 60, background: 'var(--bg-2)', border: '1px solid var(--line-2)', color: 'var(--txt)', borderRadius: 'var(--r-pill)', padding: '9px 13px', boxShadow: 'var(--shadow-pop)', cursor: 'pointer', fontSize: 12 }}
      >
        Onboarding {completed}/{steps.length}
      </button>
    );
  }

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, width: 340, zIndex: 60, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>
      {celebrate && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {Array.from({ length: 18 }).map((_, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: `${(i * 17) % 100}%`,
                top: -10,
                width: 6,
                height: 12,
                borderRadius: 2,
                background: ['var(--teal)', 'var(--amber)', 'var(--blue)', 'var(--pink)'][i % 4],
                animation: `zd-confetti 1.3s ease-out ${i * 0.035}s forwards`,
              }}
            />
          ))}
        </div>
      )}

      <div style={{ padding: 14, borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <strong style={{ fontSize: 14 }}>Primeiros passos</strong>
            <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>{completed} de {steps.length} completos</div>
          </div>
          <button onClick={() => setMinimized(true)} aria-label="Minimizar onboarding" style={{ width: 28, height: 28, borderRadius: 'var(--r)', border: 'none', background: 'transparent', color: 'var(--txt-3)', cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-4)', marginTop: 12, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${completion}%`, background: 'var(--teal)', transition: 'width .2s' }} />
        </div>
      </div>

      <div style={{ padding: 12 }}>
        {steps.map((step) => (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${step.done ? 'var(--green)' : 'var(--line-2)'}`, background: step.done ? 'var(--green-dim)' : 'transparent', color: step.done ? 'var(--green)' : 'var(--txt-3)', flexShrink: 0 }}>
              {step.done ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2.5 6.5l2 2 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : null}
            </span>
            <span style={{ flex: 1, color: step.done ? 'var(--txt-2)' : 'var(--txt)', fontSize: 13 }}>{step.label}</span>
            {!step.done && (
              <button onClick={() => navigate(step.href)} style={{ height: 28, padding: '0 10px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--teal)', fontSize: 11, cursor: 'pointer' }}>
                Abrir
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
