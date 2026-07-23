import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, ticketsApi } from '../../services/api';

type PeriodKey = 'today' | '7' | '30' | '90';

const PERIODS: Array<{ key: PeriodKey; days: number; i18nKey: string }> = [
  { key: 'today', days: 0, i18nKey: 'metrics.filters.today' },
  { key: '7', days: 7, i18nKey: 'metrics.filters.7days' },
  { key: '30', days: 30, i18nKey: 'metrics.filters.30days' },
  { key: '90', days: 90, i18nKey: 'metrics.filters.90days' },
];

// Escala de satisfação 1→5 (ruim→bom). Cada barra também leva rótulo textual,
// então a cor nunca é o único indicador (acessível a daltônicos).
const SCORE_COLORS: Record<number, string> = {
  1: '#EF4444',
  2: '#F97316',
  3: '#F59E0B',
  4: '#84CC16',
  5: '#22C55E',
};

const MONO = 'IBM Plex Mono, monospace';

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeDates(period: PeriodKey): { date_from: string; date_to: string } {
  const today = toDateInputValue(new Date());
  if (period === 'today') return { date_from: today, date_to: today };
  const days = PERIODS.find((item) => item.key === period)?.days ?? 7;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { date_from: toDateInputValue(from), date_to: today };
}

export function TicketCsatMetrics() {
  const { t } = useTranslation('omnichannel');
  const [period, setPeriod] = useState<PeriodKey>('30');
  const [agentId, setAgentId] = useState('');

  const dates = useMemo(() => computeDates(period), [period]);

  const { data: agentsData } = useQuery({
    queryKey: ['ticket-csat-agents'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    staleTime: 60_000,
  });

  const params = useMemo(
    () => ({
      date_from: dates.date_from,
      date_to: dates.date_to,
      ...(agentId ? { agent_id: agentId } : {}),
    }),
    [dates, agentId],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['ticket-csat-metrics', params],
    queryFn: () => ticketsApi.getCsatMetrics(params),
  });

  const overview = data?.overview;
  const distribution = data?.distribution ?? [];
  const maxCount = Math.max(1, ...distribution.map((item) => item.count));
  const hasData = (overview?.totalSent ?? 0) > 0;

  return (
    <div className="metrics-tickets-tab" style={{ padding: 16, overflowY: 'auto' }}>
      {/* Filtros */}
      <div className="metrics-tickets-extra-filters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
        <select
          className="filter-select"
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
          aria-label={t('metrics.ticketCsat.allAgents')}
        >
          <option value="">{t('metrics.ticketCsat.allAgents')}</option>
          {(agentsData?.data ?? []).map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="tickets-loading">{t('metrics.ticketCsat.title')}</div>
      ) : !hasData ? (
        <div className="tickets-loading">{t('metrics.ticketCsat.noData')}</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-card-header">
                <span className="metric-title">{t('metrics.ticketCsat.avgScore')}</span>
              </div>
              <div className="metric-value" style={{ color: 'var(--teal)', fontFamily: MONO }}>
                {overview?.avgScore != null ? `${overview.avgScore.toFixed(1)} ★` : '—'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card-header">
                <span className="metric-title">{t('metrics.ticketCsat.responses')}</span>
              </div>
              <div className="metric-value" style={{ color: 'var(--txt)', fontFamily: MONO }}>
                {overview?.totalResponses ?? 0}
                <span style={{ fontSize: 13, color: 'var(--txt-3)' }}>
                  {' '}/ {overview?.totalSent ?? 0}
                </span>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card-header">
                <span className="metric-title">{t('metrics.ticketCsat.responseRate')}</span>
              </div>
              <div className="metric-value" style={{ color: 'var(--txt)', fontFamily: MONO }}>
                {Math.round(overview?.responseRate ?? 0)}%
              </div>
            </div>
          </div>

          {/* Distribuição de notas */}
          <div className="chart-card">
            <h3 className="chart-title">{t('metrics.ticketCsat.distribution')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
              {[5, 4, 3, 2, 1].map((score) => {
                const point = distribution.find((item) => item.score === score);
                const count = point?.count ?? 0;
                const percentage = point?.percentage ?? 0;
                return (
                  <div key={score} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 44, flexShrink: 0, fontSize: 12, color: 'var(--txt-2)', fontFamily: MONO }}>
                      {score} ★
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 18,
                        background: 'var(--bg-3)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${(count / maxCount) * 100}%`,
                          height: '100%',
                          background: SCORE_COLORS[score],
                          borderRadius: 4,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span style={{ width: 92, flexShrink: 0, textAlign: 'right', fontSize: 12, color: 'var(--txt-3)', fontFamily: MONO }}>
                      {count} ({Math.round(percentage)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Por agente */}
          {(data?.byAgent.length ?? 0) > 0 ? (
            <div className="chart-card">
              <h3 className="chart-title">{t('metrics.ticketCsat.byAgent')}</h3>
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>{t('metrics.filters.agent')}</th>
                    <th>{t('metrics.ticketCsat.avgScore')}</th>
                    <th>{t('metrics.ticketCsat.responses')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.byAgent.map((agent) => (
                    <tr key={agent.agentId}>
                      <td>{agent.agentName}</td>
                      <td style={{ fontFamily: MONO }}>
                        {agent.avgScore != null ? `${agent.avgScore.toFixed(1)} ★` : '—'}
                      </td>
                      <td style={{ fontFamily: MONO }}>{agent.totalResponses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
