import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageShell } from '../../components/layout/PageShell';
import { useAuthStore } from '../../stores/auth.store';
import { omnichannelApi, type OmnichannelPerformanceAgent } from '../../services/api';

type Period = 'today' | '7d' | '30d' | 'month';
type TokenColor = 'teal' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'pink' | 'txt-3';

const MANAGER_ROLES = ['owner', 'admin', 'supervisor'];
const QUERY_OPTIONS = {
  staleTime: 60_000,
  refetchOnWindowFocus: false,
};

const CHART_COLORS = [
  'var(--teal)',
  'var(--blue)',
  'var(--purple)',
  'var(--amber)',
  'var(--green)',
  'var(--pink)',
  'var(--red)',
];

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: 'var(--channel-whatsapp)',
  instagram: 'var(--pink)',
  email: 'var(--blue)',
  voice: 'var(--purple)',
  webchat: 'var(--teal)',
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  email: 'E-mail',
  voice: 'Voz',
  webchat: 'Webchat',
};

const CSAT_COLORS: Record<number, string> = {
  1: 'var(--red)',
  2: 'var(--amber)',
  3: 'var(--txt-3)',
  4: 'var(--blue)',
  5: 'var(--green)',
};

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? 'var(--teal)';
}

function getPeriodDates(period: Period): { date_from: string; date_to: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  if (period === 'today') {
    return { date_from: fmt(today), date_to: fmt(today) };
  }

  if (period === '7d') {
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return { date_from: fmt(from), date_to: fmt(today) };
  }

  if (period === '30d') {
    const from = new Date(today);
    from.setDate(today.getDate() - 29);
    return { date_from: fmt(from), date_to: fmt(today) };
  }

  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { date_from: fmt(from), date_to: fmt(today) };
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMinutes(min: unknown): string {
  const value = toFiniteNumber(min);
  if (value == null || value === 0) return '—';
  if (value < 60) return `${Math.round(value)}min`;
  return `${(value / 60).toFixed(1)}h`;
}

function formatInteger(value: unknown): string {
  return new Intl.NumberFormat('pt-BR').format(toFiniteNumber(value) ?? 0);
}

function formatScore(value: unknown): string {
  const score = toFiniteNumber(value);
  return score == null ? '—' : `${score.toFixed(1)}★`;
}

function HomeAccessGuard({ children }: { children: ReactNode }) {
  const role = useAuthStore((state) => state.user?.role);
  if (!MANAGER_ROLES.includes(role ?? '')) {
    return <Navigate to="/omnichannel/conversations" replace />;
  }
  return <>{children}</>;
}

export function HomePage() {
  return (
    <HomeAccessGuard>
      <HomeContent />
    </HomeAccessGuard>
  );
}

function HomeContent() {
  const { t } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const [period, setPeriod] = useState<Period>('7d');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dates = useMemo(() => getPeriodDates(period), [period]);
  const userName = user?.name?.split(' ')[0] ?? '';

  function getSaudacao() {
    const hour = new Date().getHours();
    if (hour < 12) return t('home.greeting.morning');
    if (hour < 18) return t('home.greeting.afternoon');
    return t('home.greeting.evening');
  }

  useEffect(() => {
    document.title = 'ZiraDesk — Início';
  }, []);

  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ['home-overview', period],
    queryFn: () => omnichannelApi.metrics.getOverview(dates),
    ...QUERY_OPTIONS,
  });

  const { data: volumeData = [], isLoading: loadingVolume } = useQuery({
    queryKey: ['home-volume', period],
    queryFn: () => omnichannelApi.metrics.getVolumeByPeriod(dates),
    ...QUERY_OPTIONS,
  });

  const { data: channelData = [], isLoading: loadingChannel } = useQuery({
    queryKey: ['home-channel', period],
    queryFn: () => omnichannelApi.metrics.getByChannel(dates),
    ...QUERY_OPTIONS,
  });

  const { data: deptData = [], isLoading: loadingDept } = useQuery({
    queryKey: ['home-dept', period],
    queryFn: () => omnichannelApi.metrics.getByDepartment(dates),
    ...QUERY_OPTIONS,
  });

  const { data: peakHours = [], isLoading: loadingPeak } = useQuery({
    queryKey: ['home-peak', period],
    queryFn: () => omnichannelApi.metrics.getPeakHours(dates),
    ...QUERY_OPTIONS,
  });

  const { data: csatDist = [], isLoading: loadingCsatDist } = useQuery({
    queryKey: ['home-csat-dist', period],
    queryFn: () => omnichannelApi.metrics.getCsat(dates),
    ...QUERY_OPTIONS,
  });

  const { data: csatTime = [], isLoading: loadingCsatTime } = useQuery({
    queryKey: ['home-csat-time', period],
    queryFn: () => omnichannelApi.metrics.getCsatOverTime(dates),
    ...QUERY_OPTIONS,
  });

  const { data: orgData = [], isLoading: loadingOrg } = useQuery({
    queryKey: ['home-org', period],
    queryFn: () => omnichannelApi.metrics.getByOrganization(dates),
    ...QUERY_OPTIONS,
  });

  const { data: perfData, isLoading: loadingPerf } = useQuery({
    queryKey: ['home-perf', period],
    queryFn: () => omnichannelApi.listPerformance({
      date_from: dates.date_from,
      date_to: dates.date_to,
      per_page: 8,
      page: 1,
    }),
    ...QUERY_OPTIONS,
  });

  function refetchAll() {
    void queryClient.invalidateQueries({ queryKey: ['home-overview', period] });
    void queryClient.invalidateQueries({ queryKey: ['home-volume', period] });
    void queryClient.invalidateQueries({ queryKey: ['home-channel', period] });
    void queryClient.invalidateQueries({ queryKey: ['home-dept', period] });
    void queryClient.invalidateQueries({ queryKey: ['home-peak', period] });
    void queryClient.invalidateQueries({ queryKey: ['home-csat-dist', period] });
    void queryClient.invalidateQueries({ queryKey: ['home-csat-time', period] });
    void queryClient.invalidateQueries({ queryKey: ['home-org', period] });
    void queryClient.invalidateQueries({ queryKey: ['home-perf', period] });
  }

  const chartEmptyLabel = t('home.charts.noData');
  const topAgents = perfData?.data ?? [];
  const csatDistChartData = useMemo(
    () => csatDist.map((point) => ({
      score: toFiniteNumber(point.score) ?? 0,
      total: toFiniteNumber(point.total) ?? 0,
    })),
    [csatDist],
  );
  const csatTimeChartData = useMemo(
    () => csatTime.map((point) => ({
      ...point,
      avg_score: toFiniteNumber(point.avg_score) ?? 0,
      total: toFiniteNumber(point.total) ?? 0,
    })),
    [csatTime],
  );

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="monitor-area">
        <div className="page-head" style={{ padding: '14px 24px', flexShrink: 0 }}>
          <div>
            <h1 style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: 0,
              color: 'var(--txt)',
              margin: 0,
            }}>
              {getSaudacao()}, {userName}.
            </h1>
            <p style={{ fontSize: 11, color: 'var(--txt-3)', margin: '2px 0 0' }}>
              {t('home.subtitle')}
            </p>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              role="group"
              aria-label="Período"
              style={{
                display: 'flex',
                gap: 2,
                background: 'var(--bg-3)',
                borderRadius: 'var(--r)',
                padding: 3,
              }}
            >
              {(['today', '7d', '30d', 'month'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={period === p}
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'calc(var(--r) - 2px)',
                    fontSize: 11,
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                    background: period === p ? 'var(--bg-2)' : 'transparent',
                    color: period === p ? 'var(--txt)' : 'var(--txt-3)',
                    transition: 'all 0.15s',
                    fontFamily: 'var(--font)',
                    minHeight: 26,
                  }}
                >
                  {t(`home.period.${p}`)}
                </button>
              ))}
            </div>

            <button className="tb-btn" onClick={refetchAll} type="button">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M1 4s1-3 7-3a7 7 0 1 1-7 7" />
                <polyline points="1 1 1 4 4 4" />
              </svg>
              {t('home.refresh')}
            </button>
          </div>
        </div>

        <div className="monitor-scroll" style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="kpi-strip">
            <KpiCard
              label={t('home.kpi.total')}
              value={formatInteger(overview?.total?.total)}
              sub={`${formatInteger(overview?.total?.resolved)} ${t('home.kpi.resolved')}`}
              color="teal"
              loading={loadingOverview}
              onClick={() => navigate('/omnichannel/history')}
            />
            <KpiCard
              label={t('home.kpi.open')}
              value={formatInteger(overview?.total?.open)}
              color={(overview?.total?.open ?? 0) > 0 ? 'amber' : 'txt-3'}
              loading={loadingOverview}
              onClick={() => navigate('/omnichannel/conversations')}
            />
            <KpiCard
              label={t('home.kpi.tma')}
              value={formatMinutes(overview?.tma)}
              mono
              color="blue"
              loading={loadingOverview}
              onClick={() => navigate('/omnichannel/performance')}
            />
            <KpiCard
              label={t('home.kpi.firstResponse')}
              value={formatMinutes(overview?.first_response_minutes)}
              mono
              color="purple"
              loading={loadingOverview}
            />
            <KpiCard
              label={t('home.kpi.csat')}
              value={formatScore(overview?.csat?.avg_score)}
              mono
              color="green"
              loading={loadingOverview}
              onClick={() => navigate('/omnichannel/performance')}
            />
          </div>

          <div className="grid-2 home-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 280px)', gap: 12 }}>
            <ChartCard title={t('home.charts.volumeByDay')}>
              {loadingVolume ? (
                <ChartSkeleton height={180} />
              ) : volumeData.length === 0 ? (
                <ChartEmpty label={chartEmptyLabel} />
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={volumeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--txt-3)' }} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--txt-3)', fontFamily: 'var(--mono)' }} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'var(--txt-2)' }} />
                    <Bar dataKey="total" name={t('home.charts.total')} fill="var(--teal)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="resolved" name={t('home.charts.resolved')} fill="var(--green)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title={t('home.charts.byChannel')}>
              {loadingChannel ? (
                <ChartSkeleton height={180} />
              ) : channelData.length === 0 ? (
                <ChartEmpty label={chartEmptyLabel} />
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={channelData}
                      dataKey="total"
                      nameKey="channel_type"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={72}
                      paddingAngle={2}
                    >
                      {channelData.map((entry, i) => (
                        <Cell
                          key={entry.channel_type}
                          fill={CHANNEL_COLORS[entry.channel_type] ?? chartColor(i)}
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend
                      iconSize={8}
                      formatter={(value) => CHANNEL_LABELS[String(value)] ?? String(value)}
                      wrapperStyle={{ fontSize: 11, color: 'var(--txt-3)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <ChartCard title={t('home.charts.peakHours')} subtitle={t('home.charts.peakHoursSub')}>
            {loadingPeak ? <ChartSkeleton height={176} /> : <HeatMap data={peakHours} />}
          </ChartCard>

          <div className="grid-2 home-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <ChartCard title={t('home.charts.byDept')}>
              {loadingDept ? (
                <ChartSkeleton height={160} />
              ) : deptData.length === 0 ? (
                <ChartEmpty label={chartEmptyLabel} />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, deptData.length * 36)}>
                  <BarChart data={deptData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--txt-3)', fontFamily: 'var(--mono)' }} />
                    <YAxis type="category" dataKey="department" width={110} tick={{ fontSize: 11, fill: 'var(--txt-2)' }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="total" name={t('home.charts.total')} fill="var(--blue)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title={t('home.charts.csatDist')}>
              {loadingCsatDist ? (
                <ChartSkeleton height={160} />
              ) : csatDistChartData.length === 0 ? (
                <ChartEmpty label={chartEmptyLabel} />
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={csatDistChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="score" tick={{ fontSize: 12, fill: 'var(--txt-3)' }} tickFormatter={(score: number) => `${score}★`} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--txt-3)', fontFamily: 'var(--mono)' }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                      {csatDistChartData.map((entry) => (
                        <Cell key={entry.score} fill={CSAT_COLORS[entry.score] ?? 'var(--txt-3)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <ChartCard title={t('home.charts.csatOverTime')}>
            {loadingCsatTime ? (
              <ChartSkeleton height={160} />
            ) : csatTimeChartData.length === 0 ? (
              <ChartEmpty label={chartEmptyLabel} />
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={csatTimeChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--txt-3)' }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis domain={[1, 5]} tick={{ fontSize: 10, fill: 'var(--txt-3)', fontFamily: 'var(--mono)' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="avg_score"
                    name={t('home.charts.csatAvg')}
                    stroke="var(--green)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--green)' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <div className="grid-2 home-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <ChartCard
              title={t('home.charts.byOrg')}
              subtitle={t('home.charts.byOrgSub')}
              onTitleClick={() => navigate('/crm/organizations')}
            >
              {loadingOrg ? (
                <ChartSkeleton height={160} />
              ) : orgData.length === 0 ? (
                <ChartEmpty label={chartEmptyLabel} />
              ) : (
                <div className="home-org-chart">
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie
                        data={orgData}
                        dataKey="total"
                        nameKey="organization_name"
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={68}
                        paddingAngle={2}
                      >
                        {orgData.map((org, i) => (
                          <Cell key={org.organization_id} fill={chartColor(i)} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    {orgData.slice(0, 7).map((org, i) => (
                      <div key={org.organization_id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                        <span style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          flexShrink: 0,
                          background: chartColor(i),
                        }}
                        />
                        <span style={{
                          flex: 1,
                          color: 'var(--txt-2)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}>
                          {org.organization_name}
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)', flexShrink: 0 }}>
                          {formatInteger(org.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ChartCard>

            <ChartCard title={t('home.charts.topAgents')} onTitleClick={() => navigate('/omnichannel/performance')}>
              {loadingPerf ? (
                <AgentListSkeleton />
              ) : topAgents.length === 0 ? (
                <ChartEmpty label={chartEmptyLabel} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {topAgents.slice(0, 6).map((agent, idx) => (
                    <TopAgentRow key={agent.agent_id} agent={agent} rank={idx + 1} />
                  ))}
                </div>
              )}
            </ChartCard>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

const tooltipStyle: CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  color: 'var(--txt)',
  fontSize: 12,
};

function ChartCard({
  title,
  subtitle,
  children,
  onTitleClick,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onTitleClick?: () => void;
}) {
  return (
    <section style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      padding: '14px 16px',
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14, minWidth: 0 }}>
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            style={{
              padding: 0,
              border: 'none',
              background: 'transparent',
              fontFamily: 'var(--font)',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              textDecoration: 'underline',
              textDecorationColor: 'var(--line-2)',
            }}
          >
            {title}
          </button>
        ) : (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--txt-3)',
          }}>
            {title}
          </span>
        )}
        {subtitle && (
          <span style={{ fontSize: 10, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  color,
  mono,
  loading,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: TokenColor;
  mono?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  const style: CSSProperties = {
    flex: 1,
    minWidth: 0,
    background: 'var(--bg-2)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-lg)',
    padding: '14px 16px',
    cursor: onClick ? 'pointer' : undefined,
    transition: 'border-color 0.15s, background 0.15s',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    textAlign: 'left',
    fontFamily: 'var(--font)',
  };

  const content = (
    <>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--txt-3)',
      }}>
        {label}
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 30, width: 64, borderRadius: 'var(--r)' }} />
      ) : (
        <div style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: 0,
          fontFamily: mono ? 'var(--mono)' : undefined,
          color: `var(--${color})`,
          lineHeight: 1.12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {value}
        </div>
      )}
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{sub}</div>
      )}
    </>
  );

  if (!onClick) {
    return <div style={style}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
      }}
    >
      {content}
    </button>
  );
}

function HeatMap({ data }: { data: Array<{ day_of_week: number; hour: number; total: number }> }) {
  const maxVal = Math.max(...data.map((d) => d.total), 1);
  const map = new Map(data.map((d) => [`${d.day_of_week}-${d.hour}`, d.total]));

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '36px repeat(24, minmax(18px, 1fr))',
        gap: 2,
        minWidth: 640,
      }}>
        <div />
        {HOURS.map((h) => (
          <div key={h} style={{
            fontSize: 9,
            color: 'var(--txt-3)',
            textAlign: 'center',
            fontFamily: 'var(--mono)',
            paddingBottom: 3,
          }}>
            {h}h
          </div>
        ))}
        {DAYS.map((day, di) => (
          <Fragment key={di}>
            <div style={{
              fontSize: 10,
              color: 'var(--txt-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingRight: 6,
            }}>
              {day}
            </div>
            {HOURS.map((h) => {
              const val = map.get(`${di}-${h}`) ?? 0;
              const intensity = val / maxVal;
              const tealWeight = Math.round(15 + intensity * 70);
              return (
                <div
                  key={h}
                  title={`${day} ${h}h: ${formatInteger(val)} conversas`}
                  style={{
                    height: 18,
                    borderRadius: 3,
                    background: val === 0
                      ? 'var(--bg-3)'
                      : `color-mix(in srgb, var(--teal) ${tealWeight}%, var(--bg-3))`,
                    cursor: 'default',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1';
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div style={{
      height: 120,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      color: 'var(--txt-3)',
    }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
      <span style={{ fontSize: 11 }}>{label}</span>
    </div>
  );
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div style={{ height, display: 'grid', alignItems: 'end', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
      {Array.from({ length: 10 }).map((_, index) => (
        <div
          key={index}
          className="skeleton"
          style={{
            height: `${34 + ((index * 17) % 58)}%`,
            minHeight: 26,
            borderRadius: 4,
          }}
        />
      ))}
    </div>
  );
}

function AgentListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
          <div className="skeleton" style={{ width: 14, height: 10, borderRadius: 4 }} />
          <div className="skeleton" style={{ width: 26, height: 26, borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div className="skeleton" style={{ height: 11, width: `${45 + index * 7}%`, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 9, width: `${30 + index * 5}%`, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TopAgentRow({ agent, rank }: { agent: OmnichannelPerformanceAgent; rank: number }) {
  const overall = agent.goal_status?.overall;
  const goalColor = overall === 'ok'
    ? 'var(--green)'
    : overall === 'warning'
      ? 'var(--amber)'
      : overall === 'breach'
        ? 'var(--red)'
        : null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '7px 0',
      borderBottom: '1px solid var(--line)',
    }}>
      <span style={{
        fontFamily: 'var(--mono)',
        fontSize: 10,
        color: 'var(--txt-3)',
        width: 14,
        textAlign: 'right',
        flexShrink: 0,
      }}>
        {rank}.
      </span>
      <div className="tbl-avatar av-purple" style={{ width: 26, height: 26, fontSize: 10, flexShrink: 0 }}>
        {agent.avatar_url ? (
          <img src={agent.avatar_url} alt={agent.agent_name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          agent.agent_name.charAt(0).toUpperCase()
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--txt)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {agent.agent_name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
          {formatInteger(agent.total_conversations)} atend
          {agent.avg_tma_minutes ? ` · ${formatMinutes(agent.avg_tma_minutes)}` : ''}
          {toFiniteNumber(agent.avg_csat) != null ? ` · ${formatScore(agent.avg_csat)}` : ''}
        </div>
      </div>
      {goalColor && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: goalColor, flexShrink: 0 }} />
      )}
    </div>
  );
}
