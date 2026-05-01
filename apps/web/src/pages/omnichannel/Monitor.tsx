import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ContactAvatar } from '../../components/crm/ContactAvatar';
import { omnichannelApi, type AgentWithSkills } from '../../services/api';
import { subscribeToEvent } from '../../services/socket';

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return '0min';
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}min`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}min` : ''}`;
}

function AgentMonitorCard({
  agent,
  onViewConversations,
}: {
  agent: AgentWithSkills;
  onViewConversations: (agentId: string) => void;
}) {
  return (
    <div className={`agent-card ${agent.status}`}>
      <div className="agent-card-header">
        <ContactAvatar id={agent.id} name={agent.name} size={36} />
        <div>
          <div className="agent-name">{agent.name}</div>
          <div className="agent-role">{agent.role}</div>
        </div>
        <span className={`status-badge ${agent.status}`}>
          {agent.status === 'online' && 'Online'}
          {agent.status === 'paused' && `${agent.pause_reason ?? 'Em pausa'}`}
          {agent.status === 'offline' && 'Offline'}
        </span>
      </div>

      {agent.status === 'paused' && (
        <div className="pause-info">
          {agent.pause_reason ?? 'Pausa'} - há {formatDuration(agent.pause_started_at)}
        </div>
      )}

      <div className="agent-card-stats">
        <span>{agent.active_conversations} atendimentos ativos</span>
      </div>

      {agent.skills?.length > 0 && (
        <div className="agent-skills">
          {agent.skills.map((skill) => (
            <span
              key={skill.id}
              className="skill-chip"
              style={{
                background: `${skill.color}22`,
                color: skill.color,
                borderColor: `${skill.color}44`,
              }}
            >
              {skill.name}
            </span>
          ))}
        </div>
      )}

      {agent.active_conversations > 0 && (
        <button
          onClick={() => onViewConversations(agent.id)}
          style={{
            width: 'fit-content',
            border: '1px solid var(--line-2)',
            background: 'var(--bg-4)',
            color: 'var(--txt-2)',
            borderRadius: 'var(--r)',
            padding: '4px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Ver atendimentos
        </button>
      )}
    </div>
  );
}

export function MonitorPage() {
  const { t } = useTranslation('omnichannel');
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['monitor'],
    queryFn: omnichannelApi.monitor,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const unsubs = [
      subscribeToEvent('agent:paused', () => {
        void qc.invalidateQueries({ queryKey: ['monitor'] });
      }),
      subscribeToEvent('agent:resumed', () => {
        void qc.invalidateQueries({ queryKey: ['monitor'] });
      }),
      subscribeToEvent('conversation:created', () => {
        void qc.invalidateQueries({ queryKey: ['monitor'] });
      }),
      subscribeToEvent('conversation:updated', () => {
        void qc.invalidateQueries({ queryKey: ['monitor'] });
      }),
    ];

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [qc]);

  const queueEntries = Object.entries(data?.queue.by_department ?? {});

  return (
    <div className="monitor-page">
      <div className="monitor-header">
        <div>
          <h1>{t('monitor.title')}</h1>
          <p>{t('monitor.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void qc.invalidateQueries({ queryKey: ['monitor'] })}
          style={{
            border: '1px solid var(--line-2)',
            background: 'var(--bg-4)',
            color: 'var(--txt-2)',
            borderRadius: 'var(--r)',
            padding: '6px 10px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Atualizado agora
        </button>
      </div>

      <div className="monitor-grid">
        <section className="monitor-agents">
          <header>
            <strong>{t('monitor.agents')} ({data?.agents.length ?? 0})</strong>
          </header>

          <div className="monitor-agents-list">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
              ))
            ) : data?.agents.length ? (
              data.agents.map((agent) => (
                <AgentMonitorCard
                  key={agent.id}
                  agent={agent}
                  onViewConversations={() => navigate('/omnichannel/conversations')}
                />
              ))
            ) : (
              <p className="monitor-empty">{t('monitor.noAgents')}</p>
            )}
          </div>
        </section>

        <section className="monitor-overview">
          <div className="monitor-kpis">
            <div className="kpi-card">
              <span>{t('monitor.queue')}</span>
              <strong>{data?.queue.total ?? 0}</strong>
            </div>
            <div className="kpi-card">
              <span>{t('monitor.active')}</span>
              <strong>{data?.active.total ?? 0}</strong>
            </div>
            <div className="kpi-card">
              <span>{t('monitor.today')}</span>
              <strong>{data?.stats_today.total_resolved ?? 0}</strong>
            </div>
          </div>

          <div className="monitor-queue-card">
            <h3>{t('monitor.queue')}</h3>
            <div className="queue-bars">
              {queueEntries.length ? queueEntries.map(([tag, total]) => {
                const width = (Number(total) / Math.max(1, data?.queue.total ?? 1)) * 100;
                return (
                  <div key={tag} className="queue-row">
                    <span>{tag}</span>
                    <div className="queue-bar"><i style={{ width: `${width}%` }} /></div>
                    <strong>{total}</strong>
                  </div>
                );
              }) : <p className="monitor-empty">Sem fila no momento</p>}
            </div>

            <div className="monitor-stats-today">
              <span>{t('monitor.resolved')}: {data?.stats_today.total_resolved ?? 0}</span>
              <span>{t('monitor.avgTime')}: {Math.round(data?.stats_today.avg_resolution_minutes ?? 0)}min</span>
            </div>

            <button
              onClick={() => navigate('/omnichannel/conversations')}
              style={{
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: '#0E1A18',
                borderRadius: 'var(--r)',
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 600,
                width: 'fit-content',
                cursor: 'pointer',
              }}
            >
              {t('monitor.viewConversations')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
