import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
import {
  omnichannelApi,
  type MetricsByAgentPoint,
  type MetricsByChannelPoint,
  type MetricsByDepartmentPoint,
  type MetricsCsatPoint,
  type MetricsPeakHoursPoint,
  type MetricsVolumePoint,
} from '../../services/api';

type PeriodKey = 'today' | '7' | '30' | '90' | 'custom';

const PERIODS: Array<{ key: PeriodKey; days: number | null; i18nKey: string }> = [
  { key: 'today', days: 0, i18nKey: 'metrics.filters.today' },
  { key: '7', days: 7, i18nKey: 'metrics.filters.7days' },
  { key: '30', days: 30, i18nKey: 'metrics.filters.30days' },
  { key: '90', days: 90, i18nKey: 'metrics.filters.90days' },
  { key: 'custom', days: null, i18nKey: 'metrics.filters.custom' },
];

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  email: '#EA4335',
  instagram: '#E1306C',
  chat: '#00C9A7',
  live_chat: '#00C9A7',
};

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOURS = Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, '0')}h`);

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeDates(period: PeriodKey, customFrom: string, customTo: string): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const today = toDateInputValue(now);

  if (period === 'custom') {
    return {
      dateFrom: customFrom || today,
      dateTo: customTo || today,
    };
  }

  if (period === 'today') {
    return { dateFrom: today, dateTo: today };
  }

  const selected = PERIODS.find((item) => item.key === period);
  const days = selected?.days ?? 7;
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  return {
    dateFrom: toDateInputValue(fromDate),
    dateTo: today,
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function buildCsatDistribution(data: MetricsCsatPoint[]): Array<{ score: number; total: number }> {
  const byScore = new Map<number, number>();
  for (const item of data) byScore.set(Number(item.score), Number(item.total));
  return [1, 2, 3, 4, 5].map((score) => ({
    score,
    total: byScore.get(score) ?? 0,
  }));
}

function getPeakColor(value: number, maxValue: number): string {
  if (!value || maxValue <= 0) return 'var(--bg-3)';
  const intensity = value / maxValue;
  const alpha = 0.15 + intensity * 0.85;
  return `rgba(0, 201, 167, ${alpha})`;
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: string;
  color: string;
}

function MetricCard({ title, value, subtitle, icon, color }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-card-header">
        <span className="metric-title">{title}</span>
        <div className="metric-icon" style={{ background: `${color}22`, color }}>
          {icon}
        </div>
      </div>
      <div className="metric-value">{value}</div>
      {subtitle ? <div className="metric-subtitle">{subtitle}</div> : null}
    </div>
  );
}

function VolumeChart({ data, title }: { data: MetricsVolumePoint[]; title: string }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis
            dataKey="date"
            tick={{ fill: 'var(--txt-3)', fontSize: 11 }}
            tickFormatter={(date: string) => new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          />
          <YAxis tick={{ fill: 'var(--txt-3)', fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-2)',
              border: '1px solid var(--line-2)',
              borderRadius: 8,
              color: 'var(--txt)',
            }}
            labelFormatter={(label) => new Date(String(label)).toLocaleDateString('pt-BR')}
          />
          <Legend />
          <Line type="monotone" dataKey="total" name="Total" stroke="var(--teal)" strokeWidth={2} dot={false} />
          <Line
            type="monotone"
            dataKey="resolved"
            name="Resolvidos"
            stroke="var(--green)"
            strokeWidth={2}
            dot={false}
            strokeDasharray="4 2"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function AgentChart({ data, title }: { data: MetricsByAgentPoint[]; title: string }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis type="number" tick={{ fill: 'var(--txt-3)', fontSize: 11 }} />
          <YAxis dataKey="agent_name" type="category" width={100} tick={{ fill: 'var(--txt-2)', fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-2)',
              border: '1px solid var(--line-2)',
              borderRadius: 8,
            }}
          />
          <Bar dataKey="total" name="Total" fill="var(--teal)" radius={[0, 4, 4, 0]} />
          <Bar dataKey="resolved" name="Resolvidos" fill="var(--green)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChannelChart({ data, title }: { data: MetricsByChannelPoint[]; title: string }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="channel_type"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={(props) => {
              const payload = props?.payload as MetricsByChannelPoint | undefined;
              return `${payload?.channel_type ?? ''} ${((props?.percent ?? 0) * 100).toFixed(0)}%`;
            }}
          >
            {data.map((entry) => (
              <Cell key={entry.channel_type} fill={CHANNEL_COLORS[entry.channel_type] ?? 'var(--teal)'} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function DepartmentChart({ data, title }: { data: MetricsByDepartmentPoint[]; title: string }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis type="number" tick={{ fill: 'var(--txt-3)', fontSize: 11 }} />
          <YAxis dataKey="department" type="category" width={140} tick={{ fill: 'var(--txt-2)', fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-2)',
              border: '1px solid var(--line-2)',
              borderRadius: 8,
            }}
          />
          <Bar dataKey="total" fill="var(--blue)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PeakHoursHeatmap({ data, title }: { data: MetricsPeakHoursPoint[]; title: string }) {
  const matrix: Record<number, Record<number, number>> = {};
  for (const item of data) {
    if (!matrix[item.day_of_week]) matrix[item.day_of_week] = {};
    matrix[item.day_of_week]![item.hour] = Number(item.total);
  }
  const maxValue = Math.max(0, ...data.map((item) => Number(item.total)));

  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      <div className="heatmap-grid">
        <div className="heatmap-corner" />
        {HOURS.map((hour) => (
          <div key={hour} className="heatmap-hour-label">{hour}</div>
        ))}
        {DAYS.map((day, dayIdx) => (
          <div key={day} className="heatmap-row">
            <div className="heatmap-day-label">{day}</div>
            {HOURS.map((_, hourIdx) => {
              const value = matrix[dayIdx]?.[hourIdx] ?? 0;
              return (
                <div
                  key={`${dayIdx}-${hourIdx}`}
                  className="heatmap-cell"
                  style={{ background: getPeakColor(value, maxValue) }}
                  title={`${day} ${String(hourIdx).padStart(2, '0')}:00 — ${value} atendimentos`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function CsatChart({
  data,
  title,
}: {
  data: Array<{ score: number; total: number }>;
  title: string;
}) {
  const labels: Record<number, string> = {
    1: 'Muito ruim',
    2: 'Ruim',
    3: 'Regular',
    4: 'Bom',
    5: 'Excelente',
  };

  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <XAxis dataKey="score" tickFormatter={(score: number) => '⭐'.repeat(Number(score))} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fill: 'var(--txt-3)', fontSize: 11 }} />
          <Tooltip
            formatter={(value, _name, point) => {
              const score = Number((point?.payload as { score?: number } | undefined)?.score ?? 0);
              return [`${Number(value ?? 0)} avaliações`, labels[score] ?? ''];
            }}
            contentStyle={{
              background: 'var(--bg-2)',
              border: '1px solid var(--line-2)',
              borderRadius: 8,
            }}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.score}
                fill={
                  entry.score >= 4
                    ? 'var(--green)'
                    : entry.score === 3
                      ? 'var(--amber)'
                      : 'var(--red)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AgentTable({ data, title }: { data: MetricsByAgentPoint[]; title: string }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      <table className="metrics-table">
        <thead>
          <tr>
            <th>Agente</th>
            <th>Total</th>
            <th>Resolvidos</th>
            <th>TMA</th>
            <th>CSAT</th>
          </tr>
        </thead>
        <tbody>
          {data.map((agent) => (
            <tr key={agent.agent_id}>
              <td>{agent.agent_name}</td>
              <td>{agent.total}</td>
              <td>{agent.resolved}</td>
              <td>{agent.avg_minutes ? `${agent.avg_minutes}min` : '—'}</td>
              <td>{agent.avg_csat ? `${agent.avg_csat} ⭐` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MetricsPage() {
  const { t } = useTranslation('omnichannel');
  const [period, setPeriod] = useState<PeriodKey>('7');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [agentId, setAgentId] = useState<string>('');
  const [channelType, setChannelType] = useState<string>('');
  const [department, setDepartment] = useState<string>('');

  const { dateFrom, dateTo } = useMemo(
    () => computeDates(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const filters = useMemo(
    () => ({
      date_from: dateFrom,
      date_to: dateTo,
      ...(agentId ? { agent_id: agentId } : {}),
      ...(channelType ? { channel_type: channelType } : {}),
      ...(department ? { department } : {}),
    }),
    [agentId, channelType, dateFrom, dateTo, department],
  );

  const { data: monitorData } = useQuery({
    queryKey: ['monitor'],
    queryFn: omnichannelApi.monitor,
    staleTime: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['metrics', period, customFrom, customTo, agentId, channelType, department],
    queryFn: async () => {
      const [overview, volume, byAgent, byChannel, byDepartment, peakHours, csat] = await Promise.all([
        omnichannelApi.metrics.getOverview(filters),
        omnichannelApi.metrics.getVolume(filters),
        omnichannelApi.metrics.getByAgent(filters),
        omnichannelApi.metrics.getByChannel(filters),
        omnichannelApi.metrics.getByDepartment(filters),
        omnichannelApi.metrics.getPeakHours(filters),
        omnichannelApi.metrics.getCsat(filters),
      ]);
      return { overview, volume, byAgent, byChannel, byDepartment, peakHours, csat };
    },
  });

  const csatDistribution = useMemo(
    () => buildCsatDistribution(data?.csat ?? []),
    [data?.csat],
  );

  const resolvedRate = useMemo(() => {
    const total = data?.overview.total.total ?? 0;
    const resolved = data?.overview.total.resolved ?? 0;
    if (!total) return 0;
    return (resolved / total) * 100;
  }, [data?.overview.total.resolved, data?.overview.total.total]);

  const exportCsv = () => {
    const rows = [
      ['Agente', 'Total', 'Resolvidos', 'TMA (min)', 'CSAT'],
      ...(data?.byAgent ?? []).map((agent) => [
        agent.agent_name,
        String(agent.total),
        String(agent.resolved),
        agent.avg_minutes ? String(agent.avg_minutes) : '',
        agent.avg_csat ? String(agent.avg_csat) : '',
      ]),
    ];

    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-${dateFrom}-${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const noData = !isLoading && (data?.overview.total.total ?? 0) === 0;

  return (
    <div className="monitor-page">
      <div className="monitor-header">
        <div>
          <h1>{t('metrics.title')}</h1>
        </div>
        <button className="topbar-primary-btn" onClick={exportCsv} type="button">
          {t('metrics.export')}
        </button>
      </div>

      <div className="filters-bar">
        <div className="period-tabs">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`period-tab ${period === item.key ? 'active' : ''}`}
              onClick={() => setPeriod(item.key)}
            >
              {t(item.i18nKey)}
            </button>
          ))}
        </div>

        {period === 'custom' ? (
          <>
            <input
              type="date"
              className="filter-select"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
            <input
              type="date"
              className="filter-select"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </>
        ) : null}

        <select className="filter-select" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
          <option value="">{t('metrics.filters.allAgents')}</option>
          {(monitorData?.agents ?? []).map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>

        <select className="filter-select" value={channelType} onChange={(event) => setChannelType(event.target.value)}>
          <option value="">{t('metrics.filters.allChannels')}</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="email">E-mail</option>
          <option value="chat">Chat</option>
          <option value="live_chat">Live Chat</option>
        </select>

        <select className="filter-select" value={department} onChange={(event) => setDepartment(event.target.value)}>
          <option value="">{t('metrics.filters.allDepartments')}</option>
          {(data?.byDepartment ?? []).map((item) => (
            <option key={item.department} value={item.department}>
              {item.department}
            </option>
          ))}
        </select>
      </div>

      <div className="metrics-grid">
        <MetricCard
          title={t('metrics.cards.total')}
          value={String(data?.overview.total.total ?? 0)}
          subtitle={`${data?.overview.total.open ?? 0} em aberto`}
          icon="💬"
          color="var(--teal)"
        />
        <MetricCard
          title={t('metrics.cards.tma')}
          value={`${data?.overview.tma ?? 0}${t('metrics.tmaUnit')}`}
          subtitle="Tempo médio de atendimento"
          icon="⏱️"
          color="var(--blue)"
        />
        <MetricCard
          title={t('metrics.cards.csat')}
          value={data?.overview.csat.avg_score ? `${data.overview.csat.avg_score}⭐` : '—'}
          subtitle={`${data?.overview.csat.total_responses ?? 0} respostas`}
          icon="⭐"
          color="var(--amber)"
        />
        <MetricCard
          title={t('metrics.cards.resolved')}
          value={formatPercent(resolvedRate)}
          subtitle={`${data?.overview.total.resolved ?? 0} resolvidos`}
          icon="✅"
          color="var(--green)"
        />
        <MetricCard
          title={t('metrics.cards.firstResponse')}
          value={`${data?.overview.first_response_minutes ?? 0}${t('metrics.tmaUnit')}`}
          subtitle="Tempo médio de primeira resposta"
          icon="⚡"
          color="var(--purple)"
        />
      </div>

      {noData ? (
        <div className="chart-card">
          <p className="monitor-empty">{t('metrics.noData')}</p>
        </div>
      ) : (
        <>
          <VolumeChart data={data?.volume ?? []} title={t('metrics.charts.volume')} />

          <div className="charts-row">
            <AgentChart data={data?.byAgent ?? []} title={t('metrics.charts.byAgent')} />
            <ChannelChart data={data?.byChannel ?? []} title={t('metrics.charts.byChannel')} />
          </div>

          <DepartmentChart data={data?.byDepartment ?? []} title={t('metrics.charts.byDepartment')} />
          <PeakHoursHeatmap data={data?.peakHours ?? []} title={t('metrics.charts.peakHours')} />
          <CsatChart data={csatDistribution} title={t('metrics.charts.csatDistribution')} />
          <AgentTable data={data?.byAgent ?? []} title={t('metrics.charts.agentPerformance')} />
        </>
      )}
    </div>
  );
}
