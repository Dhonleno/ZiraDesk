import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TransferModal } from '../../components/omnichannel/TransferModal';
import { ContactAvatar } from '../../components/crm/ContactAvatar';
import { PageShell } from '../../components/layout/PageShell';
import { api, omnichannelApi, type AgentWithSkills } from '../../services/api';
import { subscribeToEvent } from '../../services/socket';
import { useToast } from '../../stores/toast.store';

interface AgentConversation {
  id: string;
  contact_name?: string | null;
  protocol_number?: string | null;
  last_message_at: string | null;
}

function formatRelativeDate(value: string | null): string {
  if (!value) return 'agora';
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function PauseTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));

    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <span style={{ fontFamily: 'var(--mono)' }}>
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </span>
  );
}

function AgentConversationsPanel({
  agentId,
  onTransfer,
}: {
  agentId: string;
  onTransfer: (conversationId: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['agent-conversations', agentId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: AgentConversation[] }>('/omnichannel/conversations', {
        params: {
          tab: 'active',
          assigned_to_me: false,
          agent_id: agentId,
          perPage: 30,
        },
      });
      return res.data.data ?? [];
    },
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--txt-3)' }}>
        Carregando atendimentos...
      </div>
    );
  }

  const conversations = data ?? [];

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8, display: 'grid', gap: 6 }}>
      {conversations.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>Nenhum atendimento ativo.</div>
      ) : (
        conversations.map((conversation) => (
          <div
            key={conversation.id}
            style={{
              border: '1px solid var(--line)',
              background: 'var(--bg-4)',
              borderRadius: 'var(--r)',
              padding: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <ContactAvatar id={conversation.id} name={conversation.contact_name ?? 'Visitante'} size={24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {conversation.contact_name ?? 'Visitante'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
                {conversation.protocol_number ?? 'Sem protocolo'} · {formatRelativeDate(conversation.last_message_at)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onTransfer(conversation.id)}
              style={{
                border: '1px solid var(--line-2)',
                background: 'var(--bg-3)',
                color: 'var(--txt-2)',
                borderRadius: 'var(--r)',
                padding: '4px 8px',
                fontSize: 11,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Transferir conversa"
            >
              Transferir
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function AgentMonitorCard({
  agent,
  expanded,
  onToggleConversations,
  onOpenFilteredConversations,
  onTransfer,
}: {
  agent: AgentWithSkills;
  expanded: boolean;
  onToggleConversations: (agentId: string) => void;
  onOpenFilteredConversations: (agentId: string) => void;
  onTransfer: (conversationId: string) => void;
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

      {agent.status === 'paused' && agent.pause_started_at && (
        <div className="pause-info" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{agent.pause_reason ?? 'Pausa'}</span>
          <span>·</span>
          <PauseTimer startedAt={agent.pause_started_at} />
        </div>
      )}

      <div className="agent-card-stats">
        <span>{agent.active_conversations} atendimentos ativos</span>
      </div>

      {agent.skills?.length > 0 && (
        <div className="agent-skills">
          {agent.skills.map((skill) => (
            <span key={skill.bot_option_id ?? skill.id} className="skill-chip">
              {skill.parent_label ? `${skill.parent_label} > ` : ''}
              {skill.label ?? skill.name}
            </span>
          ))}
        </div>
      )}

      {agent.active_conversations > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => onToggleConversations(agent.id)}
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
              {expanded
                ? '▲ Ocultar atendimentos'
                : `▼ Ver ${agent.active_conversations} atendimentos`}
            </button>

            <button
              type="button"
              onClick={() => onOpenFilteredConversations(agent.id)}
              style={{
                width: 'fit-content',
                border: '1px solid var(--line)',
                background: 'transparent',
                color: 'var(--txt-3)',
                borderRadius: 'var(--r)',
                padding: '4px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Abrir no Omnichannel
            </button>
          </div>

          {expanded && (
            <AgentConversationsPanel
              agentId={agent.id}
              onTransfer={onTransfer}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function MonitorPage() {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [transferConversationId, setTransferConversationId] = useState<string | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);

  const handleViewAgentConversations = (agentId: string) => {
    navigate(`/omnichannel/conversations?agent_id=${agentId}`);
  };

  const handleSupervisorTransfer = (conversationId: string) => {
    setTransferConversationId(conversationId);
    setShowTransferModal(true);
  };

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
      subscribeToEvent('agent:online', () => {
        void qc.invalidateQueries({ queryKey: ['monitor'] });
      }),
      subscribeToEvent('agent:offline', () => {
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
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
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
                  expanded={expandedAgentId === agent.id}
                  onToggleConversations={(agentId) => {
                    setExpandedAgentId((current) => (current === agentId ? null : agentId));
                  }}
                  onOpenFilteredConversations={handleViewAgentConversations}
                  onTransfer={handleSupervisorTransfer}
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

      {transferConversationId && (
        <TransferModal
          open={showTransferModal}
          conversationId={transferConversationId}
          onClose={() => {
            setShowTransferModal(false);
            setTransferConversationId(null);
          }}
          onTransferred={async () => {
            await qc.invalidateQueries({ queryKey: ['monitor'] });
            await qc.invalidateQueries({ queryKey: ['agent-conversations'] });
            toast.success('Conversa transferida pelo supervisor');
          }}
        />
      )}
      </div>
    </PageShell>
  );
}
