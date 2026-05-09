import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';

type Period = 'today' | '7days' | '30days';

interface MyStatsResponse {
  total: number;
  resolved: number;
  avg_minutes: number | string | null;
  avg_csat: number | string | null;
  sla_pct: number | string | null;
  onlineSince: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateFromIso(period: Period): string {
  if (period === 'today') return todayIso();
  const days = period === '7days' ? 7 : 30;
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function formatTma(minutes: number | string | null | undefined): string {
  const n = Number(minutes);
  if (!n) return '—';
  if (n < 60) return `${n}min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatCsat(score: number | string | null | undefined): string {
  if (score == null) return '—';
  return Number(score).toFixed(1);
}

function formatSla(pct: number | string | null | undefined): string {
  if (pct == null) return '—';
  return `${Number(pct).toFixed(0)}%`;
}

function formatOnline(since: string | null | undefined, now: number): string {
  if (!since) return '—';
  const diff = now - new Date(since).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '—';
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function slaColor(pct: number | string | null | undefined): string {
  if (pct == null) return 'var(--txt-2)';
  const n = Number(pct);
  if (isNaN(n)) return 'var(--txt-2)';
  if (n >= 80) return 'var(--teal)';
  if (n >= 50) return '#F59E0B';
  return '#EF4444';
}

function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-4)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
        padding: '14px 12px 12px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: 'var(--txt-3)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color,
          fontFamily: 'var(--mono)',
          lineHeight: 1,
          marginBottom: 5,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--txt-3)', lineHeight: 1.3 }}>{hint}</div>
    </div>
  );
}

export function AgentStatsModal({ open, onClose }: Props) {
  const { t } = useTranslation('omnichannel');
  const user = useAuthStore((s) => s.user);
  const [period, setPeriod] = useState<Period>('today');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-my-stats', user?.id, period],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: MyStatsResponse }>('/omnichannel/metrics/me', {
        params: {
          date_from: dateFromIso(period),
          date_to: todayIso(),
        },
      });
      return res.data.data;
    },
    enabled: open && !!user?.id,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  const PERIODS: Array<{ key: Period; label: string }> = [
    { key: 'today', label: t('myStats.periodToday') },
    { key: '7days', label: t('myStats.period7days') },
    { key: '30days', label: t('myStats.period30days') },
  ];

  return (
    <Modal open={open} onClose={onClose} title={t('myStats.title')} maxWidth="sm">
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {PERIODS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            style={{
              flex: 1,
              padding: '5px 0',
              borderRadius: 'var(--r)',
              border: `1px solid ${period === key ? 'var(--teal)' : 'var(--line)'}`,
              background: period === key ? 'var(--teal-dim)' : 'var(--bg-4)',
              color: period === key ? 'var(--teal)' : 'var(--txt-2)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all .15s',
              fontFamily: 'var(--font)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div
          style={{ padding: '28px 0', textAlign: 'center', color: 'var(--txt-3)', fontSize: 13 }}
        >
          {t('myStats.loading')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <StatCard
            label={t('myStats.totalLabel')}
            value={String(data?.total ?? 0)}
            hint={t('myStats.totalHint')}
            color="var(--blue)"
          />
          <StatCard
            label={t('myStats.resolvedLabel')}
            value={String(data?.resolved ?? 0)}
            hint={t('myStats.resolvedHint')}
            color="var(--green)"
          />
          <StatCard
            label={t('metrics.cards.tma')}
            value={formatTma(data?.avg_minutes)}
            hint={t('myStats.tmaHint')}
            color="var(--teal)"
          />
          <StatCard
            label={t('metrics.cards.csat')}
            value={formatCsat(data?.avg_csat)}
            hint={t('myStats.csatHint')}
            color="var(--amber)"
          />
          <StatCard
            label="SLA"
            value={formatSla(data?.sla_pct)}
            hint={t('myStats.slaHint')}
            color={slaColor(data?.sla_pct)}
          />
          <StatCard
            label={t('myStats.onlineLabel')}
            value={formatOnline(data?.onlineSince, now)}
            hint={t('myStats.onlineHint')}
            color="var(--txt-2)"
          />
        </div>
      )}
    </Modal>
  );
}
