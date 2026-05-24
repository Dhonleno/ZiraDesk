import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/layout/PageShell';
import {
  omnichannelApi,
  type GoalPeriod,
  type HistoryPeriodPreset,
  type OmnichannelGoal,
  type PerformanceFiltersParams,
  type PerformanceMetricStatus,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';

const PERIOD_PRESETS: Array<{ labelKey: string; value: HistoryPeriodPreset }> = [
  { labelKey: 'history.periods.today', value: 'today' },
  { labelKey: 'history.periods.yesterday', value: 'yesterday' },
  { labelKey: 'history.periods.7d', value: '7d' },
  { labelKey: 'history.periods.30d', value: '30d' },
  { labelKey: 'history.periods.month', value: 'month' },
  { labelKey: 'history.periods.custom', value: 'custom' },
];

function toNonEmpty(value: string | null): string {
  return value?.trim() ?? '';
}

function parseFilters(searchParams: URLSearchParams): PerformanceFiltersParams {
  const parsed: PerformanceFiltersParams = {
    page: Math.max(1, Number(searchParams.get('page') || '1') || 1),
    per_page: Math.max(1, Number(searchParams.get('per_page') || '25') || 25),
    period: (toNonEmpty(searchParams.get('period')) || '7d') as HistoryPeriodPreset,
  };

  const agentId = toNonEmpty(searchParams.get('agent_id'));
  if (agentId) parsed.agent_id = agentId;

  const botOptionId = toNonEmpty(searchParams.get('bot_option_id'));
  if (botOptionId) parsed.bot_option_id = botOptionId;

  const dateFrom = toNonEmpty(searchParams.get('date_from'));
  if (dateFrom) parsed.date_from = dateFrom;

  const dateTo = toNonEmpty(searchParams.get('date_to'));
  if (dateTo) parsed.date_to = dateTo;

  return parsed;
}

function hasValidCustomRange(filters: PerformanceFiltersParams): boolean {
  if (filters.period !== 'custom') return true;
  if (!filters.date_from || !filters.date_to) return false;
  return filters.date_from <= filters.date_to;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMetric(value: unknown, format: 'minutes' | 'percent' | 'csat' | 'number'): string | null {
  const numericValue = toFiniteNumber(value);
  if (numericValue === null) return null;

  if (format === 'minutes') {
    if (numericValue < 60) return `${Math.round(numericValue)}min`;
    return `${(numericValue / 60).toFixed(1)}h`;
  }
  if (format === 'percent') return `${Math.round(numericValue)}%`;
  if (format === 'csat') return `${numericValue.toFixed(1)}★`;
  return String(Math.round(numericValue));
}

function checkGoal(value: unknown, goal: unknown, type: 'max' | 'min'): PerformanceMetricStatus {
  const numericValue = toFiniteNumber(value);
  const numericGoal = toFiniteNumber(goal);
  if (numericGoal === null || numericValue === null) return 'no_goal';

  if (type === 'max') {
    if (numericValue <= numericGoal * 0.9) return 'ok';
    if (numericValue <= numericGoal) return 'warning';
    return 'breach';
  }

  if (numericValue >= numericGoal) return 'ok';
  if (numericValue >= numericGoal * 0.9) return 'warning';
  return 'breach';
}

function statusColor(status: PerformanceMetricStatus): string {
  const statusMap: Record<PerformanceMetricStatus, string> = {
    ok: 'var(--green)',
    warning: 'var(--amber)',
    breach: 'var(--red)',
    no_goal: 'var(--txt-2)',
  };
  return statusMap[status];
}

function getProgressPercent(value: unknown, goal: unknown, type: 'max' | 'min'): number | null {
  const numericValue = toFiniteNumber(value);
  const numericGoal = toFiniteNumber(goal);
  if (numericValue === null || numericGoal === null || numericGoal <= 0) return null;

  if (type === 'max') {
    return Math.max(0, Math.min(100, (numericValue / numericGoal) * 100));
  }

  return Math.max(0, Math.min(100, (numericValue / numericGoal) * 100));
}

function mapPeriodToGoalPeriod(
  period: HistoryPeriodPreset,
  dateFrom?: string,
  dateTo?: string,
): GoalPeriod {
  if (period === 'today' || period === 'yesterday') return 'daily';
  if (period === '7d') return 'weekly';
  if (period === '30d' || period === 'month') return 'monthly';

  if (period === 'custom' && dateFrom && dateTo) {
    const from = new Date(`${dateFrom}T00:00:00.000Z`).getTime();
    const to = new Date(`${dateTo}T00:00:00.000Z`).getTime();
    if (Number.isFinite(from) && Number.isFinite(to)) {
      const diffDays = Math.max(1, Math.floor((to - from) / (1000 * 60 * 60 * 24)) + 1);
      if (diffDays <= 1) return 'daily';
      if (diffDays <= 7) return 'weekly';
    }
  }

  return 'monthly';
}

function computeOverallStatus(statuses: PerformanceMetricStatus[]): PerformanceMetricStatus {
  const withGoals = statuses.filter((status) => status !== 'no_goal');
  if (withGoals.length === 0) return 'no_goal';
  if (withGoals.includes('breach')) return 'breach';
  if (withGoals.includes('warning')) return 'warning';
  return 'ok';
}

function MetricCell({
  value,
  status,
  goal,
  format,
  type,
}: {
  value: number | null;
  status: PerformanceMetricStatus;
  goal: number | null;
  format: 'minutes' | 'percent' | 'csat' | 'number';
  type: 'max' | 'min';
}) {
  const color = statusColor(status);
  const progress = getProgressPercent(value, goal, type);

  const formattedValue = formatMetric(value, format);
  const formattedGoal = formatMetric(goal, format);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ color, fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>
        {formattedValue ?? '—'}
      </span>

      {progress !== null ? (
        <div
          style={{
            height: 3,
            width: 60,
            background: 'var(--bg-5)',
            borderRadius: 'var(--r-pill)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: color,
              borderRadius: 'var(--r-pill)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      ) : null}

      {goal !== null && formattedGoal ? (
        <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
          meta: {formattedGoal}
        </span>
      ) : null}
    </div>
  );
}

function StatusBadge({ status, labels }: { status: PerformanceMetricStatus; labels: Record<PerformanceMetricStatus, string> }) {
  const config: Record<PerformanceMetricStatus, { color: string; bg: string; label: string }> = {
    ok: { label: labels.ok, color: 'var(--green)', bg: 'var(--green-dim)' },
    warning: { label: labels.warning, color: 'var(--amber)', bg: 'var(--amber-dim)' },
    breach: { label: labels.breach, color: 'var(--red)', bg: 'var(--red-dim)' },
    no_goal: { label: labels.no_goal, color: 'var(--txt-3)', bg: 'var(--bg-4)' },
  };
  const current = config[status];
  const icon = status === 'ok' ? (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path d="M2 5.5L4.4 8 9 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : status === 'warning' ? (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path d="M5.5 1.5L9.7 9h-8.4L5.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 4v2.3M5.5 7.8h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ) : status === 'breach' ? (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path d="M3 3l5 5M8 3L3 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path d="M2.5 5.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 'var(--r-pill)',
        background: current.bg,
        color: current.color,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {icon} {current.label}
    </span>
  );
}

export function PerformancePage() {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const canQueryPerformance = useMemo(() => hasValidCustomRange(filters), [filters]);

  const { data: performanceData, isLoading } = useQuery({
    queryKey: ['omnichannel-performance', filters],
    queryFn: () => omnichannelApi.listPerformance(filters),
    enabled: canQueryPerformance,
  });

  const { data: monitorData } = useQuery({
    queryKey: ['monitor'],
    queryFn: omnichannelApi.monitor,
    staleTime: 30_000,
  });

  const { data: transferSkills = [] } = useQuery({
    queryKey: ['transfer-skills'],
    queryFn: omnichannelApi.getTransferSkills,
    staleTime: 30_000,
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['omnichannel-goals'],
    queryFn: () => omnichannelApi.listGoals(),
  });

  const updateFilterParams = useCallback((values: Partial<Record<string, string | null>>, resetPage = true) => {
    const next = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(values)) {
      const normalized = typeof value === 'string' ? value.trim() : '';
      if (normalized) {
        next.set(key, normalized);
      } else {
        next.delete(key);
      }
    }

    if (resetPage) next.set('page', '1');
    if (!next.get('per_page')) next.set('per_page', String(filters.per_page ?? 25));
    setSearchParams(next);
  }, [filters.per_page, searchParams, setSearchParams]);

  const handleCustomDateChange = useCallback((field: 'date_from' | 'date_to', value: string) => {
    const nextFrom = field === 'date_from' ? value : (filters.date_from ?? '');
    const nextTo = field === 'date_to' ? value : (filters.date_to ?? '');

    if (!value) {
      updateFilterParams({ [field]: null });
      return;
    }

    if (field === 'date_from' && nextTo && value > nextTo) {
      updateFilterParams({ date_from: value, date_to: value });
      return;
    }

    if (field === 'date_to' && nextFrom && value < nextFrom) {
      updateFilterParams({ date_from: value, date_to: value });
      return;
    }

    updateFilterParams({ [field]: value });
  }, [filters.date_from, filters.date_to, updateFilterParams]);

  const handleExport = async () => {
    if (!canQueryPerformance) {
      toast.error(t('history.noResultsHint'));
      return;
    }

    try {
      const blob = await omnichannelApi.exportPerformanceCsv(filters);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `performance-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('tenantAdmin.common.errorLoad', { ns: 'admin' }));
    }
  };

  const statusLabels: Record<PerformanceMetricStatus, string> = {
    ok: t('performance.status.ok'),
    warning: t('performance.status.warning'),
    breach: t('performance.status.breach'),
    no_goal: t('performance.status.no_goal'),
  };

  const currentPage = filters.page ?? 1;
  const totalPages = performanceData?.meta.totalPages ?? 0;
  const goalPeriod = mapPeriodToGoalPeriod(filters.period ?? '7d', filters.date_from, filters.date_to);
  const globalGoal = useMemo(
    () => goals.find((goal: OmnichannelGoal) => goal.scope === 'global' && goal.period === goalPeriod && goal.isActive) ?? null,
    [goalPeriod, goals],
  );

  const teamKpiStatus = {
    tma: checkGoal(performanceData?.team_kpis.avg_tma_minutes ?? null, globalGoal?.goalTmaMinutes ?? null, 'max'),
    tme: checkGoal(performanceData?.team_kpis.avg_tme_minutes ?? null, globalGoal?.goalTmeMinutes ?? null, 'max'),
    csat: checkGoal(performanceData?.team_kpis.avg_csat ?? null, globalGoal?.goalCsatMin ?? null, 'min'),
    sla: checkGoal(performanceData?.team_kpis.sla_percent ?? null, globalGoal?.goalSlaPercent ?? null, 'min'),
    volume: checkGoal(performanceData?.team_kpis.total_volume ?? null, globalGoal?.goalVolumeMin ?? null, 'min'),
  } as const;

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="monitor-page history-page">
        <div className="monitor-header history-header">
          <div>
            <h1>{t('performance.title')}</h1>
            <p>{t('performance.subtitle')}</p>
            <div className="performance-context-note" role="note" aria-live="polite">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 1.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z" stroke="currentColor" strokeWidth="1.1" />
                <path d="M6 3.6v2.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                <circle cx="6" cy="8.1" r="0.55" fill="currentColor" />
              </svg>
              <span>{t('performance.outboundRule')}</span>
            </div>
          </div>
          <button className="zd-btn zd-btn-primary" type="button" onClick={handleExport}>
            {t('performance.exportCsv')}
          </button>
        </div>

        <div className="history-filters-grid">
          <select
            className="filter-select"
            value={filters.period ?? '7d'}
            onChange={(event) => updateFilterParams({ period: event.target.value })}
            aria-label={t('history.filters.period')}
          >
            {PERIOD_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>{t(preset.labelKey)}</option>
            ))}
          </select>

          <select
            className="filter-select"
            value={filters.agent_id ?? ''}
            onChange={(event) => updateFilterParams({ agent_id: event.target.value || null })}
            aria-label={t('history.filters.agent')}
          >
            <option value="">{t('history.filters.agent')}</option>
            {(monitorData?.agents ?? []).filter((a) => a.role === 'agent').map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>

          <select
            className="filter-select"
            value={filters.bot_option_id ?? ''}
            onChange={(event) => updateFilterParams({ bot_option_id: event.target.value || null })}
            aria-label={t('history.filters.group')}
          >
            <option value="">{t('history.filters.group')}</option>
            {transferSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>{skill.name}</option>
            ))}
          </select>

          {filters.period === 'custom' ? (
            <>
              <input
                className="filter-select"
                type="date"
                value={filters.date_from ?? ''}
                onChange={(event) => handleCustomDateChange('date_from', event.target.value)}
                aria-label={t('history.filters.startDate')}
              />
              <input
                className="filter-select"
                type="date"
                value={filters.date_to ?? ''}
                onChange={(event) => handleCustomDateChange('date_to', event.target.value)}
                aria-label={t('history.filters.endDate')}
              />
            </>
          ) : null}
        </div>

        <div className="performance-kpis-grid">
          <div className="performance-kpi-card">
            <span>{t('performance.columns.tma')}</span>
            <strong style={{ color: teamKpiStatus.tma === 'no_goal' ? 'var(--txt)' : statusColor(teamKpiStatus.tma) }}>
              {formatMetric(performanceData?.team_kpis.avg_tma_minutes ?? null, 'minutes') ?? '—'}
            </strong>
          </div>
          <div className="performance-kpi-card">
            <span>{t('performance.columns.tme')}</span>
            <strong style={{ color: teamKpiStatus.tme === 'no_goal' ? 'var(--txt)' : statusColor(teamKpiStatus.tme) }}>
              {formatMetric(performanceData?.team_kpis.avg_tme_minutes ?? null, 'minutes') ?? '—'}
            </strong>
          </div>
          <div className="performance-kpi-card">
            <span>{t('performance.columns.csat')}</span>
            <strong style={{ color: teamKpiStatus.csat === 'no_goal' ? 'var(--txt)' : statusColor(teamKpiStatus.csat) }}>
              {formatMetric(performanceData?.team_kpis.avg_csat ?? null, 'csat') ?? '—'}
            </strong>
          </div>
          <div className="performance-kpi-card">
            <span>{t('performance.columns.sla')}</span>
            <strong style={{ color: teamKpiStatus.sla === 'no_goal' ? 'var(--txt)' : statusColor(teamKpiStatus.sla) }}>
              {formatMetric(performanceData?.team_kpis.sla_percent ?? null, 'percent') ?? '—'}
            </strong>
          </div>
          <div className="performance-kpi-card">
            <span>{t('performance.columns.volume')}</span>
            <strong style={{ color: teamKpiStatus.volume === 'no_goal' ? 'var(--txt)' : statusColor(teamKpiStatus.volume) }}>
              {formatMetric(performanceData?.team_kpis.total_volume ?? 0, 'number') ?? '0'}
            </strong>
          </div>
        </div>

        <div className="history-table-wrap">
          <table className="history-table performance-table" role="grid">
            <thead>
              <tr>
                <th>{t('performance.columns.agent')}</th>
                <th>{t('performance.columns.volume')}</th>
                <th>{t('performance.columns.tma')}</th>
                <th>{t('performance.columns.tme')}</th>
                <th>{t('performance.columns.sla')}</th>
                <th>{t('performance.columns.csat')}</th>
                <th>{t('performance.columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(performanceData?.data ?? []).map((agent) => {
                const goal = agent.goal;
                const tmaStatus = checkGoal(agent.avg_tma_minutes, goal?.goal_tma_minutes ?? null, 'max');
                const tmeStatus = checkGoal(agent.avg_tme_minutes, goal?.goal_tme_minutes ?? null, 'max');
                const slaStatus = checkGoal(agent.sla_percent, goal?.goal_sla_percent ?? null, 'min');
                const csatStatus = checkGoal(agent.avg_csat, goal?.goal_csat_min ?? null, 'min');
                const volumeStatus = checkGoal(agent.total_conversations, goal?.goal_volume_min ?? null, 'min');
                const overallStatus = computeOverallStatus([tmaStatus, tmeStatus, slaStatus, csatStatus, volumeStatus]);

                return (
                  <tr
                    key={agent.agent_id}
                    style={{
                      boxShadow: agent.total_conversations === 0
                        ? 'none'
                        : overallStatus === 'breach'
                          ? 'inset 3px 0 0 var(--red)'
                          : overallStatus === 'warning'
                            ? 'inset 3px 0 0 var(--amber)'
                            : 'none',
                      background: agent.total_conversations === 0
                        ? 'transparent'
                        : overallStatus === 'breach'
                          ? 'var(--red-dim)'
                          : overallStatus === 'warning'
                            ? 'var(--amber-dim)'
                            : 'transparent',
                    }}
                  >
                    <td>
                      <div className="history-agent-cell">
                        <span className="history-agent-avatar" aria-hidden>
                          {agent.avatar_url ? <img src={agent.avatar_url} alt="" /> : agent.agent_name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="history-agent-name">{agent.agent_name}</span>
                      </div>
                    </td>
                    <td>
                      <MetricCell
                        value={agent.total_conversations}
                        status={volumeStatus}
                        goal={goal?.goal_volume_min ?? null}
                        format="number"
                        type="min"
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={agent.avg_tma_minutes}
                        status={tmaStatus}
                        goal={goal?.goal_tma_minutes ?? null}
                        format="minutes"
                        type="max"
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={agent.avg_tme_minutes}
                        status={tmeStatus}
                        goal={goal?.goal_tme_minutes ?? null}
                        format="minutes"
                        type="max"
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={agent.sla_percent}
                        status={slaStatus}
                        goal={goal?.goal_sla_percent ?? null}
                        format="percent"
                        type="min"
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={agent.avg_csat}
                        status={csatStatus}
                        goal={goal?.goal_csat_min ?? null}
                        format="csat"
                        type="min"
                      />
                    </td>
                    <td>
                      <StatusBadge status={overallStatus} labels={statusLabels} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!isLoading && (performanceData?.data.length ?? 0) === 0 ? (
            <div className="zd-empty-state history-empty">
              <div className="zd-empty-icon" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M5 4.5h12v10H9l-4 3v-3H5v-10Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              </div>
              <div>{t('history.noResults')}</div>
              <div className="history-empty-hint">{t('history.noResultsHint')}</div>
            </div>
          ) : null}
        </div>

        <div className="history-pagination">
          <button
            type="button"
            className="zd-btn"
            disabled={currentPage <= 1}
            onClick={() => updateFilterParams({ page: String(Math.max(1, currentPage - 1)) }, false)}
          >
            ‹
          </button>
          <span>
            {currentPage} / {Math.max(totalPages, 1)}
          </span>
          <button
            type="button"
            className="zd-btn"
            disabled={totalPages === 0 || currentPage >= totalPages}
            onClick={() => updateFilterParams({ page: String(currentPage + 1) }, false)}
          >
            ›
          </button>
        </div>
      </div>
    </PageShell>
  );
}
