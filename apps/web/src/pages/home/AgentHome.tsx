import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/layout/PageShell';
import { useAuth } from '../../hooks/useAuth';
import { api, omnichannelApi, ticketsApi, type PerformanceMetricStatus } from '../../services/api';

type Period = 'today' | '7d' | '30d' | 'month';
type TokenColor = 'teal' | 'blue' | 'green' | 'amber' | 'purple' | 'red';

const PERIODS: Period[] = ['today', '7d', '30d', 'month'];

function getPeriodDates(period: Period): { date_from: string; date_to: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (period === 'today') return { date_from: fmt(today), date_to: fmt(today) };
  if (period === '7d') {
    const from = new Date(today); from.setDate(today.getDate() - 6);
    return { date_from: fmt(from), date_to: fmt(today) };
  }
  if (period === '30d') {
    const from = new Date(today); from.setDate(today.getDate() - 29);
    return { date_from: fmt(from), date_to: fmt(today) };
  }
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { date_from: fmt(from), date_to: fmt(today) };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatMinutes(min: number | null | undefined): string {
  if (min == null || min === 0) return '—';
  if (min < 60) return `${Math.round(min)}min`;
  return `${(min / 60).toFixed(1)}h`;
}

function getGoalStatusColor(status?: PerformanceMetricStatus | null): TokenColor {
  if (status === 'ok') return 'green';
  if (status === 'warning') return 'amber';
  if (status === 'breach') return 'red';
  return 'teal';
}

function getSaudacao(t: (key: string) => string): string {
  const h = new Date().getHours();
  if (h < 12) return t('home.greeting.morning');
  if (h < 18) return t('home.greeting.afternoon');
  return t('home.greeting.evening');
}

export default function AgentHome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('today');

  const agentId = user?.id ?? '';
  const dates = useMemo(() => getPeriodDates(period), [period]);
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    document.title = 'ZiraDesk - Início';
  }, []);

  if (user?.role && user.role !== 'agent') {
    const to = ['owner', 'admin', 'supervisor'].includes(user.role)
      ? '/home'
      : '/omnichannel/conversations';
    return <Navigate to={to} replace />;
  }

  // Contadores de conversas
  const { data: convCounts } = useQuery({
    queryKey: ['agent-conv-counts'],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { open: number; waiting: number; mine: number } }>(
          '/omnichannel/conversations/counts',
        )
        .then((r) => r.data.data),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Tickets por status (per_page: 1 → só interessa meta.total)
  const { data: ticketsOpen } = useQuery({
    queryKey: ['agent-tickets-open', agentId],
    queryFn: () =>
      ticketsApi.list({ assigned_to: agentId, status: 'open', per_page: 1 }).then((r) => r.meta.total),
    enabled: Boolean(agentId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: ticketsInProgress } = useQuery({
    queryKey: ['agent-tickets-inprogress', agentId],
    queryFn: () =>
      ticketsApi.list({ assigned_to: agentId, status: 'in_progress', per_page: 1 }).then((r) => r.meta.total),
    enabled: Boolean(agentId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: ticketsWaiting } = useQuery({
    queryKey: ['agent-tickets-waiting', agentId],
    queryFn: () =>
      ticketsApi.list({ assigned_to: agentId, status: 'waiting', per_page: 1 }).then((r) => r.meta.total),
    enabled: Boolean(agentId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: ticketsDueToday } = useQuery({
    queryKey: ['agent-tickets-due', agentId, todayStr],
    queryFn: async () => {
      const res = await ticketsApi.list({ assigned_to: agentId, per_page: 200 });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
      return res.data.filter((ticket) => {
        if (!ticket.due_date) return false;
        const d = new Date(ticket.due_date);
        return d >= today && d < tomorrow && !['resolved', 'closed'].includes(ticket.status);
      }).length;
    },
    enabled: Boolean(agentId),
    refetchInterval: 300_000,
    staleTime: 60_000,
  });

  const { data: ticketsOverdue } = useQuery({
    queryKey: ['agent-tickets-overdue', agentId, todayStr],
    queryFn: async () => {
      const res = await ticketsApi.list({ assigned_to: agentId, per_page: 200 });
      const now = new Date();
      return res.data.filter((ticket) => {
        if (!ticket.due_date) return false;
        return new Date(ticket.due_date) < now && !['resolved', 'closed'].includes(ticket.status);
      }).length;
    },
    enabled: Boolean(agentId),
    refetchInterval: 300_000,
    staleTime: 60_000,
  });

  // Métricas pessoais do período
  const { data: myStats, isLoading: loadingStats } = useQuery({
    queryKey: ['agent-stats', period, agentId],
    queryFn: () =>
      api
        .get<{
          success: boolean;
          data: {
            total: number;
            resolved: number;
            avg_minutes: number | string | null;
            avg_csat: number | string | null;
            sla_pct: number | string | null;
          };
        }>('/omnichannel/metrics/me', { params: dates })
        .then((r) => r.data.data),
    enabled: Boolean(agentId),
    staleTime: 60_000,
  });

  // Performance + metas do período
  const { data: perfData } = useQuery({
    queryKey: ['agent-perf', period, agentId],
    queryFn: () =>
      omnichannelApi.listPerformance({
        date_from: dates.date_from,
        date_to: dates.date_to,
        agent_id: agentId,
        per_page: 1,
        page: 1,
      }),
    enabled: Boolean(agentId),
    staleTime: 60_000,
  });

  const agentPerf = perfData?.data?.[0] ?? null;
  const goal = agentPerf?.goal ?? null;
  const goalStatus = agentPerf?.goal_status ?? null;

  const tma = toNumber(myStats?.avg_minutes);
  const csat = toNumber(myStats?.avg_csat);
  const sla = toNumber(myStats?.sla_pct);

  const slaColor: TokenColor =
    sla !== null && sla < 70 ? 'red' : sla !== null && sla < 90 ? 'amber' : 'green';

  return (
    <PageShell padding={0}>
      <div className="monitor-area">
        {/* PAGE HEAD */}
        <div className="page-head" style={{ padding: '14px 24px', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.4px', color: 'var(--txt)', margin: 0 }}>
              {getSaudacao(t)}, {user?.name?.split(' ')[0]}.
            </h1>
            <p style={{ fontSize: 11, color: 'var(--txt-3)', margin: '2px 0 0' }}>
              {t('agentHome.subtitle')}
            </p>
          </div>
        </div>

        {/* SCROLL AREA */}
        <div
          className="monitor-scroll"
          style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {/* LINHA 1: Atendimentos + Tickets */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Card: Meus atendimentos */}
            <WorkspaceCard
              title={t('agentHome.conversations.title')}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              }
              cta={t('agentHome.conversations.cta')}
              onCta={() => navigate('/omnichannel/conversations')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <WorkspaceRow
                  color="teal"
                  label={t('agentHome.conversations.open')}
                  value={convCounts?.mine ?? 0}
                  onClick={() => navigate('/omnichannel/conversations?tab=open')}
                />
                <WorkspaceRow
                  color="amber"
                  label={t('agentHome.conversations.waiting')}
                  value={convCounts?.waiting ?? 0}
                  onClick={() => navigate('/omnichannel/conversations?tab=waiting')}
                />
              </div>
            </WorkspaceCard>

            {/* Card: Meus tickets */}
            <WorkspaceCard
              title={t('agentHome.tickets.title')}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="2" />
                  <line x1="9" y1="12" x2="15" y2="12" />
                  <line x1="9" y1="16" x2="13" y2="16" />
                </svg>
              }
              cta={t('agentHome.tickets.cta')}
              onCta={() => navigate('/tickets')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <WorkspaceRow
                  color="teal"
                  label={t('agentHome.tickets.open')}
                  value={ticketsOpen ?? 0}
                  onClick={() => navigate('/tickets?status=open')}
                />
                <WorkspaceRow
                  color="blue"
                  label={t('agentHome.tickets.inProgress')}
                  value={ticketsInProgress ?? 0}
                  onClick={() => navigate('/tickets?status=in_progress')}
                />
                <WorkspaceRow
                  color="purple"
                  label={t('agentHome.tickets.waiting')}
                  value={ticketsWaiting ?? 0}
                  onClick={() => navigate('/tickets?status=waiting')}
                />
                {(ticketsDueToday ?? 0) > 0 && (
                  <WorkspaceRow
                    color="amber"
                    label={t('agentHome.tickets.dueToday')}
                    value={ticketsDueToday ?? 0}
                    onClick={() => navigate('/tickets')}
                  />
                )}
                {(ticketsOverdue ?? 0) > 0 && (
                  <WorkspaceRow
                    color="red"
                    label={t('agentHome.tickets.overdue')}
                    value={ticketsOverdue ?? 0}
                    onClick={() => navigate('/tickets')}
                  />
                )}
              </div>
            </WorkspaceCard>
          </div>

          {/* LINHA 2: Métricas + Metas */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Card: Minhas métricas */}
            <WorkspaceCard
              title={t('agentHome.metrics.title')}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              }
              headerRight={
                <div style={{
                  display: 'flex', gap: 2,
                  background: 'var(--bg-3)',
                  borderRadius: 'var(--r)', padding: 2,
                }}>
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 'calc(var(--r) - 2px)',
                        fontSize: 10, fontWeight: 500,
                        border: 'none', cursor: 'pointer',
                        background: period === p ? 'var(--bg-2)' : 'transparent',
                        color: period === p ? 'var(--txt)' : 'var(--txt-3)',
                        fontFamily: 'var(--font)',
                        transition: 'all .15s',
                      }}
                    >
                      {t(`home.period.${p}`)}
                    </button>
                  ))}
                </div>
              }
              cta={t('agentHome.metrics.cta')}
              onCta={() => navigate('/omnichannel/performance')}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <MetricBlock
                  label={t('agentHome.kpi.total')}
                  value={myStats?.total ?? 0}
                  sub={`${myStats?.resolved ?? 0} ${t('agentHome.kpi.resolved')}`}
                  color="teal"
                  loading={loadingStats}
                />
                <MetricBlock
                  label={t('agentHome.kpi.tma')}
                  value={formatMinutes(tma)}
                  mono
                  color="blue"
                  loading={loadingStats}
                />
                <MetricBlock
                  label={t('agentHome.kpi.csat')}
                  value={csat != null ? `${csat.toFixed(1)}★` : '—'}
                  mono
                  color="green"
                  loading={loadingStats}
                />
                <MetricBlock
                  label={t('agentHome.kpi.sla')}
                  value={sla != null ? `${Math.round(sla)}%` : '—'}
                  mono
                  color={slaColor}
                  loading={loadingStats}
                />
              </div>
            </WorkspaceCard>

            {/* Card: Progresso das metas */}
            <WorkspaceCard
              title={t('agentHome.goals.title')}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              }
              headerRight={goal ? (
                <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>{goal.name}</span>
              ) : undefined}
            >
              {!goal ? (
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '20px 0', color: 'var(--txt-3)',
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span style={{ fontSize: 12 }}>{t('agentHome.goals.noGoal')}</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {goal.goal_volume_min != null && (
                    <GoalBar
                      label={t('agentHome.kpi.total')}
                      value={myStats?.total ?? 0}
                      target={goal.goal_volume_min}
                      status={goalStatus?.volume ?? null}
                      formatValue={(v) => String(Math.round(v ?? 0))}
                    />
                  )}
                  {goal.goal_tma_minutes != null && tma != null && (
                    <GoalBar
                      label={t('agentHome.kpi.tma')}
                      value={tma}
                      target={goal.goal_tma_minutes}
                      status={goalStatus?.tma ?? null}
                      formatValue={formatMinutes}
                      inverse
                    />
                  )}
                  {goal.goal_csat_min != null && csat != null && (
                    <GoalBar
                      label={t('agentHome.kpi.csat')}
                      value={csat}
                      target={goal.goal_csat_min}
                      status={goalStatus?.csat ?? null}
                      formatValue={(v) => (v != null ? `${v.toFixed(1)}★` : '—')}
                      maxValue={5}
                    />
                  )}
                  {goal.goal_sla_percent != null && sla != null && (
                    <GoalBar
                      label={t('agentHome.kpi.sla')}
                      value={sla}
                      target={goal.goal_sla_percent}
                      status={goalStatus?.sla ?? null}
                      formatValue={(v) => (v != null ? `${Math.round(v)}%` : '—')}
                      maxValue={100}
                    />
                  )}
                </div>
              )}
            </WorkspaceCard>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function WorkspaceCard({
  title, icon, children, cta, onCta, headerRight,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  cta?: string;
  onCta?: () => void;
  headerRight?: ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px',
        borderBottom: '1px solid var(--line)',
      }}>
        <span style={{ color: 'var(--txt-3)' }}>{icon}</span>
        <span style={{
          fontSize: 11, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          color: 'var(--txt-3)',
        }}>
          {title}
        </span>
        {headerRight && (
          <div style={{ marginLeft: 'auto' }}>{headerRight}</div>
        )}
      </div>

      <div style={{ padding: '14px 16px', flex: 1 }}>
        {children}
      </div>

      {cta && onCta && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
          <button
            type="button"
            onClick={onCta}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, fontSize: 11, fontWeight: 500,
              color: 'var(--teal)', fontFamily: 'var(--font)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {cta}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function WorkspaceRow({
  color, label, value, onClick,
}: {
  color: TokenColor;
  label: string;
  value: number;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 'var(--r)',
        cursor: onClick ? 'pointer' : undefined,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { if (onClick) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-3)'; }}
      onMouseLeave={(e) => { if (onClick) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: `var(--${color})`, flexShrink: 0,
      }} />
      <span style={{ flex: 1, fontSize: 13, color: 'var(--txt-2)' }}>{label}</span>
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 600,
        color: value > 0 ? `var(--${color})` : 'var(--txt-3)',
        letterSpacing: '-0.3px',
      }}>
        {value}
      </span>
    </div>
  );
}

function MetricBlock({
  label, value, sub, color, mono, loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: TokenColor;
  mono?: boolean;
  loading?: boolean;
}) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--bg-3)',
      borderRadius: 'var(--r)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.07em',
        color: 'var(--txt-3)', marginBottom: 4,
      }}>
        {label}
      </div>
      {loading ? (
        <div style={{ height: 24, width: 48, borderRadius: 4, background: 'var(--bg-4)' }} />
      ) : (
        <div style={{
          fontSize: 20, fontWeight: 600, letterSpacing: '-0.4px',
          fontFamily: mono ? 'var(--mono)' : undefined,
          color: `var(--${color})`,
        }}>
          {value}
        </div>
      )}
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function GoalBar({
  label,
  value,
  target,
  status,
  inverse,
  formatValue,
  maxValue,
}: {
  label: string;
  value: number | null;
  target: number | null | undefined;
  status?: PerformanceMetricStatus | null;
  inverse?: boolean;
  formatValue: (value: number | null | undefined) => string;
  maxValue?: number;
}) {
  const safeValue = value ?? 0;
  const safeTarget = target ?? 0;
  const color = getGoalStatusColor(status);

  let pct: number;
  if (inverse) {
    const rawPct = safeTarget > 0 ? (safeValue / safeTarget) * 100 : 0;
    pct = Math.max(0, Math.min(100, safeValue <= safeTarget ? 100 : 100 - (rawPct - 100)));
  } else {
    const barBase = maxValue ?? safeTarget;
    pct = barBase > 0 ? Math.min(100, (safeValue / barBase) * 100) : 0;
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
        <span style={{ color: 'var(--txt-2)', fontWeight: 500 }}>{label}</span>
        <span style={{ color: `var(--${color})`, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
          {formatValue(value)} / {formatValue(target)}
        </span>
      </div>
      <div style={{ height: 7, borderRadius: 'var(--r-pill)', background: 'var(--bg-4)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 'var(--r-pill)',
          background: `var(--${color})`,
        }} />
      </div>
    </div>
  );
}
