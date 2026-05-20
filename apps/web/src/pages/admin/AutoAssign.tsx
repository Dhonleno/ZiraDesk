import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type AutoAssignAgent } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../stores/toast.store';
import { subscribeToEvent } from '../../services/socket';
import { PageShell } from '../../components/layout/PageShell';

function formatRelative(dateIso: string, locale: string): string {
  const date = new Date(dateIso);
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

function roleLabel(role: string, t: (key: string) => string): string {
  if (role === 'owner') return t('tenantAdmin.users.roles.owner');
  if (role === 'admin') return t('tenantAdmin.users.roles.admin');
  if (role === 'supervisor') return t('tenantAdmin.users.roles.supervisor');
  if (role === 'agent') return t('tenantAdmin.users.roles.agent');
  return role;
}

function formatPauseAgo(startedAt: string, locale: string): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 1) return '1min';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  return formatter.format(-days, 'day');
}

export function AutoAssign() {
  const { t, i18n } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [autoAssignEnabled, setAutoAssignEnabled] = useState(false);
  const [algorithm, setAlgorithm] = useState<'round_robin'>('round_robin');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'auto-assign'],
    queryFn: adminApi.autoAssign.getConfig,
  });

  useEffect(() => {
    if (!data) return;
    setAutoAssignEnabled(data.auto_assign);
    setAlgorithm(data.auto_assign_algorithm);
  }, [data]);

  useEffect(() => {
    const offPaused = subscribeToEvent<{ userId: string }>('agent:paused', () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'auto-assign'] });
    });
    const offResumed = subscribeToEvent<{ userId: string }>('agent:resumed', () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'auto-assign'] });
    });

    return () => {
      offPaused();
      offResumed();
    };
  }, [queryClient]);

  const saveMutation = useMutation({
    mutationFn: () => adminApi.autoAssign.updateConfig({
      auto_assign: autoAssignEnabled,
      auto_assign_algorithm: algorithm,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'auto-assign'] });
      toast.success(t('tenantAdmin.autoAssign.messages.saved'));
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const toggleAgentMutation = useMutation({
    mutationFn: ({ userId, isAvailable }: { userId: string; isAvailable: boolean }) =>
      adminApi.autoAssign.toggleAgent(userId, { is_available: isAvailable }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'auto-assign'] });
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const resetMutation = useMutation({
    mutationFn: adminApi.autoAssign.reset,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'auto-assign'] });
      toast.success(t('tenantAdmin.autoAssign.messages.reset'));
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const agents = useMemo(() => data?.agents ?? [], [data]);
  const pausedAgents = useMemo(
    () => agents.filter((agent) => agent.status === 'paused' && agent.pause_started_at),
    [agents],
  );

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
            {t('tenantAdmin.autoAssign.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.autoAssign.subtitle')}
          </p>
        </div>

        <div className="rounded-xl p-6 space-y-6" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
              ))}
            </div>
          ) : (
            <>
              <label className="flex items-center justify-between gap-4 rounded-lg px-4 py-3" style={{ background: 'var(--bg-3)', border: '1px solid var(--line)' }}>
                <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                  {t('tenantAdmin.autoAssign.active')}
                </span>
                <input
                  type="checkbox"
                  checked={autoAssignEnabled}
                  onChange={(event) => setAutoAssignEnabled(event.target.checked)}
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                  {t('tenantAdmin.autoAssign.algorithm')}
                </label>
                <select
                  value={algorithm}
                  onChange={(event) => setAlgorithm(event.target.value as 'round_robin')}
                  style={{
                    background: 'var(--bg-3)',
                    border: '1px solid var(--line)',
                    color: 'var(--txt)',
                    height: '2.5rem',
                    borderRadius: '0.5rem',
                    padding: '0 0.75rem',
                    fontSize: '0.875rem',
                    width: '220px',
                    outline: 'none',
                  }}
                >
                  <option value="round_robin">{t('tenantAdmin.autoAssign.roundRobin')}</option>
                </select>
              </div>

            <div className="space-y-3">
              <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                {t('tenantAdmin.autoAssign.agents')}
              </p>

              <div className="space-y-2 rounded-lg p-2" style={{ border: '1px solid var(--line)', background: 'var(--bg-3)' }}>
                {agents.map((agent: AutoAssignAgent) => (
                  <label
                    key={agent.user_id}
                    className="flex items-center justify-between gap-4 rounded-md px-3 py-2"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--txt)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {agent.name} - {roleLabel(agent.role, t)}
                        <span
                          style={{
                            fontSize: 10,
                            padding: '2px 8px',
                            borderRadius: 999,
                            border: '1px solid var(--line-2)',
                            background:
                              agent.status === 'paused'
                                ? 'var(--amber-dim)'
                                : agent.status === 'offline'
                                  ? 'var(--bg-4)'
                                  : 'var(--green-dim)',
                            color:
                              agent.status === 'paused'
                                ? 'var(--amber)'
                                : agent.status === 'offline'
                                  ? 'var(--txt-3)'
                                  : 'var(--green)',
                          }}
                        >
                          {agent.status === 'paused'
                            ? t('tenantAdmin.pause.status.paused')
                            : agent.status === 'offline'
                              ? t('tenantAdmin.pause.status.offline')
                              : t('tenantAdmin.pause.status.online')}
                        </span>
                      </p>
                      <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
                        {t('tenantAdmin.autoAssign.activeConversations', { count: agent.active_conversations })}
                        {' - '}
                        {t('tenantAdmin.autoAssign.lastAssigned', {
                          time: formatRelative(agent.last_assigned_at, i18n.language),
                        })}
                      </p>
                      {agent.status === 'paused' && agent.pause_started_at && (
                        <p className="text-xs" style={{ color: 'var(--amber)', marginTop: 2 }}>
                          {(agent.pause_reason ?? t('tenantAdmin.pause.reasons.other'))} - {formatPauseAgo(agent.pause_started_at, i18n.language)}
                        </p>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      checked={agent.is_available}
                      onChange={(event) =>
                        toggleAgentMutation.mutate({ userId: agent.user_id, isAvailable: event.target.checked })
                      }
                      disabled={toggleAgentMutation.isPending}
                    />
                  </label>
                ))}

                {agents.length === 0 && (
                  <p className="px-3 py-4 text-sm" style={{ color: 'var(--txt-3)' }}>
                    {t('tenantAdmin.common.noResults')}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                {t('tenantAdmin.pause.supervisor.pausedAgents')}
              </p>
              <div className="space-y-2 rounded-lg p-2" style={{ border: '1px solid var(--line)', background: 'var(--bg-3)' }}>
                {pausedAgents.length === 0 ? (
                  <p className="px-3 py-3 text-sm" style={{ color: 'var(--txt-3)' }}>
                    {t('tenantAdmin.pause.supervisor.noPauses')}
                  </p>
                ) : (
                  pausedAgents.map((agent) => (
                    <div
                      key={`paused-${agent.user_id}`}
                      className="flex items-center justify-between rounded-md px-3 py-2"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
                    >
                      <span style={{ color: 'var(--txt)', fontSize: 13 }}>
                        {agent.name}
                      </span>
                      <span style={{ color: 'var(--amber)', fontSize: 12 }}>
                        {agent.pause_reason ?? t('tenantAdmin.pause.reasons.other')} - {agent.pause_started_at ? formatPauseAgo(agent.pause_started_at, i18n.language) : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                onClick={() => {
                  const confirmed = window.confirm(t('tenantAdmin.autoAssign.resetConfirm'));
                  if (confirmed) resetMutation.mutate();
                }}
                disabled={resetMutation.isPending}
                variant="secondary"
              >
                {t('tenantAdmin.autoAssign.reset')}
              </Button>

              <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
              </Button>
            </div>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
