import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import './Performance.css';
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
  { labelKey: 'history.periods.last_week', value: 'last_week' },
  { labelKey: 'history.periods.last_month', value: 'last_month' },
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

function statusClass(status: PerformanceMetricStatus): string {
  return `is-${status.replace('_', '-')}`;
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
  if (period === '7d' || period === 'last_week') return 'weekly';
  if (period === '30d' || period === 'month' || period === 'last_month') return 'monthly';

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
  const progress = getProgressPercent(value, goal, type);

  const formattedValue = formatMetric(value, format);
  const formattedGoal = formatMetric(goal, format);

  return (
    <div className="performance-metric-cell">
      <span className={`performance-metric-value ${statusClass(status)}`}>
        {formattedValue ?? '—'}
      </span>

      {progress !== null ? (
        <div className="performance-progress">
          <div
            className={`performance-progress-fill ${statusClass(status)}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      {goal !== null && formattedGoal ? (
        <span className="performance-goal-hint">
          meta: {formattedGoal}
        </span>
      ) : null}
    </div>
  );
}

function StatusBadge({ status, labels }: { status: PerformanceMetricStatus; labels: Record<PerformanceMetricStatus, string> }) {
  const config: Record<PerformanceMetricStatus, { label: string }> = {
    ok: { label: labels.ok },
    warning: { label: labels.warning },
    breach: { label: labels.breach },
    no_goal: { label: labels.no_goal },
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
    <span className={`performance-status-badge ${statusClass(status)}`}>
      {icon} {current.label}
    </span>
  );
}

function KpiCard({
  label,
  value,
  status,
  labels,
}: {
  label: string;
  value: string;
  status: PerformanceMetricStatus;
  labels: Record<PerformanceMetricStatus, string>;
}) {
  return (
    <div className={`performance-kpi-card ${statusClass(status)}`}>
      <div className="performance-kpi-card-head">
        <span>{label}</span>
        <StatusBadge status={status} labels={labels} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="performance-state" role="status" aria-live="polite">
      <div className="performance-loading-spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({
  title,
  hint,
  variant = 'teal',
}: {
  title: string;
  hint: string;
  variant?: 'teal' | 'blue';
}) {
  return (
    <div className="zd-empty-state history-empty performance-empty">
      <div className={`zd-empty-icon performance-empty-icon ${variant}`} aria-hidden>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M4 17V6M9 17V9M14 17V4M19 17V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M3 17.5h16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </div>
      <div>{title}</div>
      <div className="history-empty-hint">{hint}</div>
    </div>
  );
}

export function PerformancePage() {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'agent' | 'department'>('agent');
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

  const { data: performanceByGroupData, isLoading: isLoadingByGroup } = useQuery({
    queryKey: ['omnichannel-performance-by-group', filters],
    queryFn: () => omnichannelApi.listPerformanceByGroup(filters),
    enabled: canQueryPerformance && activeTab === 'department',
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
      toast.error(t('performance.invalidRange'));
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
      <div className="monitor-page history-page performance-page">
        <div className="monitor-header history-header">
          <div>
            <h1>{t('performance.title')}</h1>
            <p>{t('performance.subtitle')}</p>
          </div>
          <button className="zd-btn zd-btn-primary" type="button" onClick={handleExport}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <path d="M6.5 1.5v6M4 5l2.5 2.5L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.5 8.5v2h8v-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('performance.exportCsv')}
          </button>
        </div>

        <div className="performance-filter-bar">
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
            {(monitorData?.agents ?? []).filter((a) =>
              ['agent', 'supervisor', 'admin', 'owner'].includes(a.role)
            ).map((agent) => (
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
          <KpiCard
            label={t('performance.columns.tma')}
            value={formatMetric(performanceData?.team_kpis.avg_tma_minutes ?? null, 'minutes') ?? '—'}
            status={teamKpiStatus.tma}
            labels={statusLabels}
          />
          <KpiCard
            label={t('performance.columns.tme')}
            value={formatMetric(performanceData?.team_kpis.avg_tme_minutes ?? null, 'minutes') ?? '—'}
            status={teamKpiStatus.tme}
            labels={statusLabels}
          />
          <KpiCard
            label={t('performance.columns.csat')}
            value={formatMetric(performanceData?.team_kpis.avg_csat ?? null, 'csat') ?? '—'}
            status={teamKpiStatus.csat}
            labels={statusLabels}
          />
          <KpiCard
            label={t('performance.columns.sla')}
            value={formatMetric(performanceData?.team_kpis.sla_percent ?? null, 'percent') ?? '—'}
            status={teamKpiStatus.sla}
            labels={statusLabels}
          />
          <KpiCard
            label={t('performance.columns.volume')}
            value={formatMetric(performanceData?.team_kpis.total_volume ?? 0, 'number') ?? '0'}
            status={teamKpiStatus.volume}
            labels={statusLabels}
          />
        </div>

        <div className="history-tabs performance-tabs" role="tablist" aria-label={t('performance.table.viewMode')}>
          {(['agent', 'department'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={activeTab === tab ? 'active' : undefined}
              role="tab"
              aria-selected={activeTab === tab}
            >
              {tab === 'agent' ? t('performance.byAgent') : t('performance.byDepartment')}
            </button>
          ))}
        </div>

        <div className="history-table-wrap">
          {activeTab === 'department' ? (
            <>
              {isLoadingByGroup ? (
                <LoadingState label={t('performance.loadingDepartments')} />
              ) : (performanceByGroupData?.data.length ?? 0) === 0 ? (
                <EmptyState
                  title={t('performance.emptyDepartmentsTitle')}
                  hint={t('performance.emptyDepartmentsHint')}
                  variant="blue"
                />
              ) : (
                <table className="history-table performance-table" role="grid">
                  <thead>
                    <tr>
                      <th>{t('performance.table.department')}</th>
                      <th>{t('performance.columns.volume')}</th>
                      <th>{t('performance.columns.tma')}</th>
                      <th>{t('performance.columns.tme')}</th>
                      <th>{t('performance.columns.sla')}</th>
                      <th>{t('performance.columns.csat')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(performanceByGroupData?.data ?? []).map((row, idx) => (
                      <tr key={row.group_name ?? `__no_group_${idx}`}>
                        <td>
                          <span className="performance-entity-name">
                            {row.group_name}
                          </span>
                        </td>
                        <td>
                          <MetricCell
                            value={row.total_conversations}
                            status="no_goal"
                            goal={null}
                            format="number"
                            type="min"
                          />
                        </td>
                        <td>
                          <MetricCell
                            value={row.avg_tma_minutes}
                            status="no_goal"
                            goal={null}
                            format="minutes"
                            type="max"
                          />
                        </td>
                        <td>
                          <MetricCell
                            value={row.avg_tme_minutes}
                            status="no_goal"
                            goal={null}
                            format="minutes"
                            type="max"
                          />
                        </td>
                        <td>
                          <MetricCell
                            value={row.sla_percent}
                            status="no_goal"
                            goal={null}
                            format="percent"
                            type="min"
                          />
                        </td>
                        <td>
                          <MetricCell
                            value={row.avg_csat}
                            status="no_goal"
                            goal={null}
                            format="csat"
                            type="min"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
          <>
          {isLoading ? (
            <LoadingState label={t('performance.loadingAgents')} />
          ) : (performanceData?.data.length ?? 0) === 0 ? (
            <EmptyState
              title={t('performance.emptyAgentsTitle')}
              hint={t('performance.emptyAgentsHint')}
            />
          ) : (
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
                const goal         = agent.goal;
                const tmaStatus    = agent.goal_status?.tma    ?? 'no_goal';
                const tmeStatus    = agent.goal_status?.tme    ?? 'no_goal';
                const slaStatus    = agent.goal_status?.sla    ?? 'no_goal';
                const csatStatus   = agent.goal_status?.csat   ?? 'no_goal';
                const volumeStatus = agent.goal_status?.volume ?? 'no_goal';
                const overallStatus = agent.goal_status?.overall ?? 'no_goal';

                return (
                  <tr
                    key={agent.agent_id}
                    className={agent.total_conversations > 0 && ['breach', 'warning'].includes(overallStatus)
                      ? `performance-row-alert ${statusClass(overallStatus)}`
                      : undefined}
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
          )}
          </>
          )}
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
