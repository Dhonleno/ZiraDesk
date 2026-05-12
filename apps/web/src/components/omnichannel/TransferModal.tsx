import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { omnichannelApi, type TransferAgent, type TransferSkill } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface Props {
  open: boolean;
  conversationId: string;
  currentAgentId?: string | null;
  onClose: () => void;
  onTransferred?: (agent: { id: string; name: string }) => Promise<void>;
}

type Tab = 'agent' | 'skill';

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function AgentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function TransferModal({ open, conversationId, currentAgentId, onClose, onTransferred }: Props) {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>('agent');
  const [search, setSearch] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab('agent');
    setSearch('');
    setSelectedAgentId(null);
    setSelectedSkillId(null);
    setReason('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  useEffect(() => {
    setSearch('');
    setSelectedAgentId(null);
    setSelectedSkillId(null);
  }, [tab]);

  const { data: agents = [], isLoading: loadingAgents } = useQuery({
    queryKey: ['transfer-agents', currentAgentId ?? null],
    queryFn: () => omnichannelApi.getTransferAgents(currentAgentId ?? undefined),
    enabled: open,
    staleTime: 10_000,
  });

  const { data: skills = [], isLoading: loadingSkills } = useQuery({
    queryKey: ['transfer-skills'],
    queryFn: () => omnichannelApi.getTransferSkills(),
    enabled: open,
    staleTime: 10_000,
  });

  const filteredAgents = search.trim()
    ? agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : agents;

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const selectedSkill = skills.find((s) => s.id === selectedSkillId) ?? null;

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (tab === 'agent' && selectedAgentId) {
        return omnichannelApi.transfer(conversationId, { userId: selectedAgentId }, reason.trim() || undefined);
      }
      if (tab === 'skill' && selectedSkillId) {
        return omnichannelApi.transfer(conversationId, { skillId: selectedSkillId }, reason.trim() || undefined);
      }
      throw new Error('Nenhuma seleção');
    },
    onSuccess: async () => {
      const label = tab === 'agent' ? selectedAgent?.name : selectedSkill?.name;
      if (tab === 'agent' && selectedAgent && onTransferred) {
        await onTransferred({ id: selectedAgent.id, name: selectedAgent.name });
      }
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      toast.success(t('transfer.transferred', { name: label ?? '' }));
      onClose();
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
      if (code === 'AGENT_OFFLINE') {
        toast.error(t('transfer.agentOffline'));
      } else if (code === 'NO_AGENTS_AVAILABLE_FOR_SKILL') {
        toast.error(t('transfer.noAgentsForSkill'));
      } else {
        toast.error(t('transfer.error', { defaultValue: 'Erro ao transferir conversa' }));
      }
    },
  });

  const canSubmit =
    !transferMutation.isPending &&
    ((tab === 'agent' && selectedAgentId !== null) || (tab === 'skill' && selectedSkillId !== null));

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'var(--backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>
            {t('transfer.title')}
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--line)',
            background: 'var(--bg-3)',
          }}
        >
          {(['agent', 'skill'] as const).map((value) => {
            const active = tab === value;
            const Icon = value === 'agent' ? AgentIcon : SkillIcon;
            const label = value === 'agent' ? t('transfer.byAgent') : t('transfer.bySkill');
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
                  color: active ? 'var(--teal)' : 'var(--txt-3)',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  fontFamily: 'var(--font)',
                  cursor: 'pointer',
                  transition: 'color 0.15s',
                }}
              >
                <Icon />
                {label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'agent' && (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('transfer.searchAgent')}
                style={{
                  width: '100%',
                  background: 'var(--bg-3)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  color: 'var(--txt)',
                  fontSize: 13,
                  fontFamily: 'var(--font)',
                  padding: '9px 11px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />

              <div
                style={{
                  maxHeight: 220,
                  overflowY: 'auto',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r)',
                  background: 'var(--bg-3)',
                }}
              >
                {loadingAgents ? (
                  <div style={{ padding: 12, color: 'var(--txt-3)', fontSize: 12 }}>
                    {t('history.loading')}
                  </div>
                ) : filteredAgents.length === 0 ? (
                  <div style={{ padding: 12, color: 'var(--txt-3)', fontSize: 12 }}>
                    {t('transfer.noAgents')}
                  </div>
                ) : (
                  filteredAgents.map((agent: TransferAgent) => {
                    const selected = selectedAgentId === agent.id;
                    const available = agent.is_available && agent.active_conversations === 0;
                    const badgeColor = available ? 'var(--teal)' : 'var(--yellow, #f59e0b)';
                    const badgeBg = available ? 'var(--teal-dim)' : 'color-mix(in srgb, var(--yellow, #f59e0b) 15%, transparent)';
                    const badgeLabel = available
                      ? t('transfer.available')
                      : t('transfer.inService', { count: agent.active_conversations });

                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setSelectedAgentId(agent.id)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          background: selected ? 'var(--teal-dim)' : 'transparent',
                          border: 'none',
                          borderBottom: '1px solid var(--line)',
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg,#667eea,#764ba2)',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: 13,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {initials(agent.name)}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500 }}>
                            {agent.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--txt-3)', textTransform: 'capitalize' }}>
                            {agent.role}
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: badgeColor,
                            background: badgeBg,
                            padding: '2px 7px',
                            borderRadius: 99,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          {badgeLabel}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {tab === 'skill' && (
            <div
              style={{
                maxHeight: 260,
                overflowY: 'auto',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r)',
                background: 'var(--bg-3)',
              }}
            >
              {loadingSkills ? (
                <div style={{ padding: 12, color: 'var(--txt-3)', fontSize: 12 }}>
                  {t('history.loading')}
                </div>
              ) : skills.length === 0 ? (
                <div style={{ padding: 12, color: 'var(--txt-3)', fontSize: 12 }}>
                  {t('transfer.noSkills')}
                </div>
              ) : (
                skills.map((skill: TransferSkill) => {
                  const selected = selectedSkillId === skill.id;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => setSelectedSkillId(skill.id)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        background: selected ? 'var(--teal-dim)' : 'transparent',
                        border: 'none',
                        borderBottom: '1px solid var(--line)',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500 }}>
                        {skill.name}
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--teal)',
                          background: 'var(--teal-dim)',
                          padding: '2px 7px',
                          borderRadius: 99,
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {t('transfer.onlineAgents', { count: skill.online_agents_count })}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Reason */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--txt-2)', marginBottom: 6 }}>
              {t('transfer.reason')}
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('transfer.reasonPlaceholder')}
              style={{
                width: '100%',
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                color: 'var(--txt)',
                fontFamily: 'var(--font)',
                fontSize: 13,
                padding: '10px 12px',
                resize: 'vertical',
                outline: 'none',
                minHeight: 78,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={transferMutation.isPending}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)',
                background: 'var(--bg-4)',
                color: 'var(--txt-2)',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'var(--font)',
              }}
            >
              {t('transfer.cancel', { defaultValue: 'Cancelar' })}
            </button>
            <button
              type="button"
              onClick={() => transferMutation.mutate()}
              disabled={!canSubmit}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: '#0E1A18',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--font)',
                opacity: canSubmit ? 1 : 0.65,
              }}
            >
              {t('transfer.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
