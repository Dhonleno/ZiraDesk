import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';
import { omnichannelApi, type GoalPayload, type GoalScope, type OmnichannelGoal } from '../../services/api';
import { useToast } from '../../stores/toast.store';

type GoalFormState = {
  id: string | null;
  name: string;
  scope: GoalScope;
  agentId: string;
  period: 'daily' | 'weekly' | 'monthly';
  goalTmaMinutes: string;
  goalTmeMinutes: string;
  goalSlaPercent: string;
  goalCsatMin: string;
  goalVolumeMin: string;
  isActive: boolean;
};

type GoalFieldErrors = Partial<Record<keyof GoalFormState, string>>;

type NumericGoalField = Extract<keyof GoalFormState, 'goalTmaMinutes' | 'goalTmeMinutes' | 'goalSlaPercent' | 'goalCsatMin' | 'goalVolumeMin'>;

const GOAL_LIMITS = {
  nameMax: 100,
  minutesMin: 1,
  minutesMax: 1440,
  slaMin: 0,
  slaMax: 100,
  csatMin: 1,
  csatMax: 5,
  volumeMin: 1,
  volumeMax: 100000,
} as const;

const EMPTY_FORM: GoalFormState = {
  id: null,
  name: '',
  scope: 'global',
  agentId: '',
  period: 'monthly',
  goalTmaMinutes: '',
  goalTmeMinutes: '',
  goalSlaPercent: '',
  goalCsatMin: '',
  goalVolumeMin: '',
  isActive: true,
};

function toInputString(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function toNullableInt(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function toNullableFloat(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeDecimalInput(value: string): string {
  return value.replace(',', '.');
}

function parseOptionalNumber(value: string): number | null {
  const normalized = normalizeDecimalInput(value).trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function buildGoalValidationErrors(form: GoalFormState, t: TFunction<'omnichannel'>): GoalFieldErrors {
  const errors: GoalFieldErrors = {};
  const name = form.name.trim();

  if (!name) {
    errors.name = t('goals.validation.nameRequired');
  } else if (name.length > GOAL_LIMITS.nameMax) {
    errors.name = t('goals.validation.nameMax', { max: GOAL_LIMITS.nameMax });
  }

  if (form.scope === 'agent' && !form.agentId) {
    errors.agentId = t('goals.validation.agentRequired');
  }

  const validateIntRange = (field: NumericGoalField, min: number, max: number) => {
    const value = parseOptionalNumber(form[field]);
    if (value === null) return;
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      errors[field] = t('goals.validation.integer');
      return;
    }
    if (value < min || value > max) {
      errors[field] = t('goals.validation.range', { min, max });
    }
  };

  const validateDecimalRange = (field: NumericGoalField, min: number, max: number) => {
    const value = parseOptionalNumber(form[field]);
    if (value === null) return;
    if (!Number.isFinite(value)) {
      errors[field] = t('goals.validation.number');
      return;
    }
    if (value < min || value > max) {
      errors[field] = t('goals.validation.range', { min, max });
    }
  };

  validateIntRange('goalTmaMinutes', GOAL_LIMITS.minutesMin, GOAL_LIMITS.minutesMax);
  validateIntRange('goalTmeMinutes', GOAL_LIMITS.minutesMin, GOAL_LIMITS.minutesMax);
  validateIntRange('goalSlaPercent', GOAL_LIMITS.slaMin, GOAL_LIMITS.slaMax);
  validateDecimalRange('goalCsatMin', GOAL_LIMITS.csatMin, GOAL_LIMITS.csatMax);
  validateIntRange('goalVolumeMin', GOAL_LIMITS.volumeMin, GOAL_LIMITS.volumeMax);

  return errors;
}

function GoalFieldMessage({ error, hint }: { error?: string | undefined; hint?: string | undefined }) {
  if (error) return <small className="history-goal-field-error">{error}</small>;
  if (hint) return <small className="history-goal-field-hint">{hint}</small>;
  return null;
}

function mapGoalToForm(goal: OmnichannelGoal): GoalFormState {
  const normalizedScope: GoalScope = goal.scope === 'agent' ? 'agent' : 'global';
  return {
    id: goal.id,
    name: goal.name,
    scope: normalizedScope,
    agentId: goal.agentId ?? '',
    period: goal.period,
    goalTmaMinutes: toInputString(goal.goalTmaMinutes),
    goalTmeMinutes: toInputString(goal.goalTmeMinutes),
    goalSlaPercent: toInputString(goal.goalSlaPercent),
    goalCsatMin: toInputString(goal.goalCsatMin),
    goalVolumeMin: toInputString(goal.goalVolumeMin),
    isActive: goal.isActive,
  };
}

function GoalMetricPill({
  label,
  value,
  color,
  background,
}: {
  label: string;
  value: string;
  color: string;
  background: string;
}) {
  return (
    <div className="history-goal-pill" style={{ color, background }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function extractApiErrorMessage(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
  return typeof message === 'string' && message.trim().length > 0 ? message : null;
}

export function GoalsConfig() {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<GoalFormState>(EMPTY_FORM);

  const { data: goals = [] } = useQuery({
    queryKey: ['omnichannel-goals'],
    queryFn: () => omnichannelApi.listGoals(),
  });

  const { data: monitorData } = useQuery({
    queryKey: ['monitor'],
    queryFn: omnichannelApi.monitor,
    staleTime: 30_000,
  });

  const sortedAgents = useMemo(
    () => [...(monitorData?.agents ?? [])].filter((a) => a.role === 'agent').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [monitorData?.agents],
  );

  const validationErrors = useMemo(() => buildGoalValidationErrors(form, t), [form, t]);
  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  const upsertMutation = useMutation({
    mutationFn: async (payload: GoalPayload) => {
      if (form.id) {
        return omnichannelApi.updateGoal(form.id, payload);
      }
      return omnichannelApi.createGoal(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['omnichannel-goals'] });
      setOpen(false);
      setForm(EMPTY_FORM);
      toast.success(t('goals.saveSuccess'));
    },
    onError: (error) => {
      const apiMessage = extractApiErrorMessage(error);
      toast.error(apiMessage ?? t('tenantAdmin.common.errorSave', { ns: 'admin' }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (goalId: string) => omnichannelApi.deleteGoal(goalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['omnichannel-goals'] });
      toast.success(t('goals.deleteSuccess'));
    },
    onError: (error) => {
      const apiMessage = extractApiErrorMessage(error);
      toast.error(apiMessage ?? t('tenantAdmin.common.errorSave', { ns: 'admin' }));
    },
  });

  const openForCreate = () => {
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openForEdit = (goal: OmnichannelGoal) => {
    setForm(mapGoalToForm(goal));
    setOpen(true);
  };

  const handleDelete = (goalId: string) => {
    const confirmed = window.confirm(t('tenantAdmin.common.remove', { ns: 'admin' }));
    if (!confirmed) return;
    deleteMutation.mutate(goalId);
  };

  const handleSave = () => {
    if (hasValidationErrors) {
      toast.error(t('goals.validation.fixBeforeSave'));
      return;
    }

    const payload: GoalPayload = {
      name: form.name.trim(),
      scope: form.scope,
      period: form.period,
      agentId: form.scope === 'agent' ? (form.agentId || null) : null,
      goalTmaMinutes: toNullableInt(normalizeDecimalInput(form.goalTmaMinutes)),
      goalTmeMinutes: toNullableInt(normalizeDecimalInput(form.goalTmeMinutes)),
      goalSlaPercent: toNullableInt(normalizeDecimalInput(form.goalSlaPercent)),
      goalCsatMin: toNullableFloat(normalizeDecimalInput(form.goalCsatMin)),
      goalVolumeMin: toNullableInt(normalizeDecimalInput(form.goalVolumeMin)),
      isActive: form.isActive,
    };
    upsertMutation.mutate(payload);
  };

  const canSave = form.name.trim().length > 0
    && (form.scope !== 'agent' || Boolean(form.agentId))
    && !hasValidationErrors;

  const goalMetricDefs = [
    {
      key: 'goalTmaMinutes',
      label: 'TMA',
      color: 'var(--blue)',
      background: 'var(--blue-dim)',
      value: (goal: OmnichannelGoal) => `<= ${goal.goalTmaMinutes}${t('metrics.tmaUnit')}`,
    },
    {
      key: 'goalTmeMinutes',
      label: 'TME',
      color: 'var(--teal)',
      background: 'var(--teal-dim)',
      value: (goal: OmnichannelGoal) => `<= ${goal.goalTmeMinutes}${t('metrics.tmaUnit')}`,
    },
    {
      key: 'goalSlaPercent',
      label: 'SLA',
      color: 'var(--green)',
      background: 'var(--green-dim)',
      value: (goal: OmnichannelGoal) => `>= ${goal.goalSlaPercent}%`,
    },
    {
      key: 'goalCsatMin',
      label: 'CSAT',
      color: 'var(--amber)',
      background: 'var(--amber-dim)',
      value: (goal: OmnichannelGoal) => `>= ${goal.goalCsatMin}★`,
    },
    {
      key: 'goalVolumeMin',
      label: t('performance.columns.volume'),
      color: 'var(--purple)',
      background: 'var(--purple-dim)',
      value: (goal: OmnichannelGoal) => `>= ${goal.goalVolumeMin}`,
    },
  ] as const;

  const renderScopeLabel = (goal: OmnichannelGoal): string => {
    if (goal.scope === 'global') {
      return t('goals.scope.global');
    }

    if (goal.scope === 'group') {
      return goal.botOptionLabel ?? t('history.filters.group');
    }

    return goal.agentName ?? t('goals.scope.agent');
  };

  return (
    <div className="history-goals-wrap">
      <div className="history-goals-head">
        <button className="tb-btn-primary" type="button" onClick={openForCreate}>
          + {t('goals.new')}
        </button>
      </div>

      <div className="history-goals-grid">
        {goals.map((goal) => (
          <article key={goal.id} className="history-goal-card">
            <header className="history-goal-card-head">
              <div className="history-goal-card-title">
                <strong>{goal.name}</strong>
                <span>
                  {renderScopeLabel(goal)}
                  <i aria-hidden>·</i>
                  {t(`goals.period.${goal.period}`)}
                </span>
              </div>
              <div className="history-goal-actions">
                <button
                  className="tb-icon-btn"
                  type="button"
                  title={t('tenantAdmin.common.edit', { ns: 'admin' })}
                  aria-label={t('tenantAdmin.common.edit', { ns: 'admin' })}
                  onClick={() => openForEdit(goal)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  className="tb-icon-btn"
                  type="button"
                  title={t('tenantAdmin.common.remove', { ns: 'admin' })}
                  aria-label={t('tenantAdmin.common.remove', { ns: 'admin' })}
                  onClick={() => handleDelete(goal.id)}
                  style={{ color: 'var(--red)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M2 4h10M5 4V2.5h4V4M5.5 6.5v4M8.5 6.5v4M3 4l.8 7.5h6.4L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </header>

            <div className="history-goal-metrics">
              {goalMetricDefs.map((metric) => {
                const metricValue = goal[metric.key];
                if (metricValue === null || metricValue === undefined) {
                  return null;
                }

                return (
                  <GoalMetricPill
                    key={metric.key}
                    label={metric.label}
                    value={metric.value(goal)}
                    color={metric.color}
                    background={metric.background}
                  />
                );
              })}
            </div>
          </article>
        ))}

        {goals.length === 0 ? (
          <div className="history-goals-empty">
            <div className="history-goals-empty-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 11h6M11 8v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="history-goals-empty-copy">
              <strong>{t('goals.empty')}</strong>
              <p>{t('goals.emptyHint')}</p>
            </div>
            <button className="tb-btn-primary" type="button" onClick={openForCreate}>
              + {t('goals.new')}
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="history-goal-modal-overlay" role="dialog" aria-modal="true">
          <div className="history-goal-modal">
            <div className="history-goal-modal-head">
              <strong>{form.id ? t('tenantAdmin.common.edit', { ns: 'admin' }) : t('goals.new')}</strong>
              <button className="zd-btn" type="button" onClick={() => setOpen(false)}>
                {t('tenantAdmin.common.close', { ns: 'admin' })}
              </button>
            </div>

            <div className="history-goal-form-grid">
              <label>
                <span>{t('goals.name')}</span>
                <input
                  className={`zd-input${form.name.trim() && validationErrors.name ? ' is-invalid' : ''}`}
                  value={form.name}
                  maxLength={GOAL_LIMITS.nameMax}
                  aria-invalid={Boolean(form.name.trim() && validationErrors.name)}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                />
                <GoalFieldMessage error={form.name.trim() ? validationErrors.name : undefined} hint={t('goals.validation.nameHint', { max: GOAL_LIMITS.nameMax })} />
              </label>

              <label>
                <span>{t('history.filters.group')}</span>
                <select
                  className="filter-select"
                  value={form.scope}
                  onChange={(event) => setForm((prev) => ({
                    ...prev,
                    scope: event.target.value as GoalScope,
                    agentId: event.target.value === 'agent' ? prev.agentId : '',
                  }))}
                >
                  <option value="global">{t('goals.scope.global')}</option>
                  <option value="agent">{t('goals.scope.agent')}</option>
                </select>
              </label>

              {form.scope === 'agent' ? (
                <label>
                  <span>{t('history.filters.agent')}</span>
                  <select
                    className={`filter-select${validationErrors.agentId ? ' is-invalid' : ''}`}
                    value={form.agentId}
                    aria-invalid={Boolean(validationErrors.agentId)}
                    onChange={(event) => setForm((prev) => ({ ...prev, agentId: event.target.value }))}
                  >
                    <option value="">—</option>
                    {sortedAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </select>
                  <GoalFieldMessage error={validationErrors.agentId} />
                </label>
              ) : null}

              <label>
                <span>{t('history.filters.period')}</span>
                <select
                  className="filter-select"
                  value={form.period}
                  onChange={(event) => setForm((prev) => ({ ...prev, period: event.target.value as GoalFormState['period'] }))}
                >
                  <option value="daily">{t('goals.period.daily')}</option>
                  <option value="weekly">{t('goals.period.weekly')}</option>
                  <option value="monthly">{t('goals.period.monthly')}</option>
                </select>
              </label>

              <label>
                <span>{t('goals.metrics.tma')}</span>
                <input
                  className={`zd-input${form.goalTmaMinutes.trim() && validationErrors.goalTmaMinutes ? ' is-invalid' : ''}`}
                  type="number"
                  inputMode="numeric"
                  min={GOAL_LIMITS.minutesMin}
                  max={GOAL_LIMITS.minutesMax}
                  step={1}
                  value={form.goalTmaMinutes}
                  aria-invalid={Boolean(form.goalTmaMinutes.trim() && validationErrors.goalTmaMinutes)}
                  onChange={(event) => setForm((prev) => ({ ...prev, goalTmaMinutes: event.target.value }))}
                />
                <GoalFieldMessage
                  error={form.goalTmaMinutes.trim() ? validationErrors.goalTmaMinutes : undefined}
                  hint={t('goals.validation.minutesHint', { min: GOAL_LIMITS.minutesMin, max: GOAL_LIMITS.minutesMax })}
                />
              </label>

              <label>
                <span>{t('goals.metrics.tme')}</span>
                <input
                  className={`zd-input${form.goalTmeMinutes.trim() && validationErrors.goalTmeMinutes ? ' is-invalid' : ''}`}
                  type="number"
                  inputMode="numeric"
                  min={GOAL_LIMITS.minutesMin}
                  max={GOAL_LIMITS.minutesMax}
                  step={1}
                  value={form.goalTmeMinutes}
                  aria-invalid={Boolean(form.goalTmeMinutes.trim() && validationErrors.goalTmeMinutes)}
                  onChange={(event) => setForm((prev) => ({ ...prev, goalTmeMinutes: event.target.value }))}
                />
                <GoalFieldMessage
                  error={form.goalTmeMinutes.trim() ? validationErrors.goalTmeMinutes : undefined}
                  hint={t('goals.validation.minutesHint', { min: GOAL_LIMITS.minutesMin, max: GOAL_LIMITS.minutesMax })}
                />
              </label>

              <label>
                <span>{t('goals.metrics.sla')}</span>
                <input
                  className={`zd-input${form.goalSlaPercent.trim() && validationErrors.goalSlaPercent ? ' is-invalid' : ''}`}
                  type="number"
                  inputMode="numeric"
                  min={GOAL_LIMITS.slaMin}
                  max={GOAL_LIMITS.slaMax}
                  step={1}
                  value={form.goalSlaPercent}
                  aria-invalid={Boolean(form.goalSlaPercent.trim() && validationErrors.goalSlaPercent)}
                  onChange={(event) => setForm((prev) => ({ ...prev, goalSlaPercent: event.target.value }))}
                />
                <GoalFieldMessage
                  error={form.goalSlaPercent.trim() ? validationErrors.goalSlaPercent : undefined}
                  hint={t('goals.validation.percentHint', { min: GOAL_LIMITS.slaMin, max: GOAL_LIMITS.slaMax })}
                />
              </label>

              <label>
                <span>{t('goals.metrics.csat')}</span>
                <input
                  className={`zd-input${form.goalCsatMin.trim() && validationErrors.goalCsatMin ? ' is-invalid' : ''}`}
                  type="number"
                  inputMode="decimal"
                  min={GOAL_LIMITS.csatMin}
                  max={GOAL_LIMITS.csatMax}
                  step={0.1}
                  value={form.goalCsatMin}
                  aria-invalid={Boolean(form.goalCsatMin.trim() && validationErrors.goalCsatMin)}
                  onChange={(event) => setForm((prev) => ({ ...prev, goalCsatMin: event.target.value }))}
                />
                <GoalFieldMessage
                  error={form.goalCsatMin.trim() ? validationErrors.goalCsatMin : undefined}
                  hint={t('goals.validation.csatHint', { min: GOAL_LIMITS.csatMin, max: GOAL_LIMITS.csatMax })}
                />
              </label>

              <label>
                <span>{t('goals.metrics.volume')}</span>
                <input
                  className={`zd-input${form.goalVolumeMin.trim() && validationErrors.goalVolumeMin ? ' is-invalid' : ''}`}
                  type="number"
                  inputMode="numeric"
                  min={GOAL_LIMITS.volumeMin}
                  max={GOAL_LIMITS.volumeMax}
                  step={1}
                  value={form.goalVolumeMin}
                  aria-invalid={Boolean(form.goalVolumeMin.trim() && validationErrors.goalVolumeMin)}
                  onChange={(event) => setForm((prev) => ({ ...prev, goalVolumeMin: event.target.value }))}
                />
                <GoalFieldMessage
                  error={form.goalVolumeMin.trim() ? validationErrors.goalVolumeMin : undefined}
                  hint={t('goals.validation.volumeHint', { min: GOAL_LIMITS.volumeMin, max: GOAL_LIMITS.volumeMax })}
                />
              </label>
            </div>

            <div className="history-goal-modal-actions">
              <button className="zd-btn" type="button" onClick={() => setOpen(false)}>
                {t('tenantAdmin.common.cancel', { ns: 'admin' })}
              </button>
              <button
                className="zd-btn zd-btn-primary"
                type="button"
                onClick={handleSave}
                disabled={!canSave || upsertMutation.isPending}
              >
                {t('tenantAdmin.common.save', { ns: 'admin' })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
