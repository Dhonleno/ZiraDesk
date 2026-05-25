import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ContactAvatar } from '../crm/ContactAvatar';
import { Modal } from '../ui/Modal';
import { omnichannelApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface RequestHelpModalProps {
  conversationId: string;
  currentUserId?: string;
  onClose: () => void;
  onRequested?: () => Promise<void> | void;
}

export function RequestHelpModal({
  conversationId,
  currentUserId,
  onClose,
  onRequested,
}: RequestHelpModalProps) {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const { data: monitor } = useQuery({
    queryKey: ['monitor'],
    queryFn: omnichannelApi.monitor,
  });

  const onlineAgents = (monitor?.agents ?? []).filter(
    (agent) => agent.status === 'online' && agent.id !== currentUserId,
  );

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) return;
      await omnichannelApi.requestHelp(conversationId, selectedAgent);
    },
    onSuccess: async () => {
      await onRequested?.();
      toast.success(t('help.send'));
      onClose();
    },
    onError: () => {
      toast.error(t('help.requestError'));
    },
  });

  return (
    <Modal open onClose={onClose} title={t('help.requestTitle')} maxWidth="sm">
      <p style={{ color: 'var(--txt-2)', fontSize: 13, marginBottom: 16 }}>
        {t('help.requestHint')}
      </p>

      <div className="agents-list">
        {onlineAgents.length ? (
          onlineAgents.map((agent) => (
            <div
              key={agent.id}
              className={`agent-item ${selectedAgent === agent.id ? 'selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${agent.name} - ${agent.status === 'online' ? 'online' : agent.status}`}
              onClick={() => setSelectedAgent(agent.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedAgent(agent.id);
                }
              }}
            >
              <ContactAvatar id={agent.id} name={agent.name} size={32} />
              <div>
                <div className="agent-name">{agent.name}</div>
                <div className="agent-meta">{agent.role} - {agent.active_conversations} atend.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {agent.skills?.map((skill) => (
                    <span key={skill.bot_option_id ?? skill.id} className="skill-chip" style={{ fontSize: 10 }}>
                      {skill.label ?? skill.name}
                    </span>
                  ))}
                </div>
              </div>
              <span className="status-dot online" />
            </div>
          ))
        ) : (
          <p className="monitor-empty">{t('help.noAgentsAvailable')}</p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button
          type="button"
          onClick={onClose}
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
          {t('closeModal.cancel')}
        </button>
        <button
          type="button"
          onClick={() => requestMutation.mutate()}
          disabled={!selectedAgent || requestMutation.isPending}
          style={{
            border: '1px solid var(--teal)',
            background: 'var(--teal)',
            color: 'var(--on-teal)',
            borderRadius: 'var(--r)',
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: !selectedAgent || requestMutation.isPending ? 'not-allowed' : 'pointer',
            opacity: !selectedAgent || requestMutation.isPending ? 0.6 : 1,
          }}
        >
          {requestMutation.isPending ? t('help.sending') : t('help.send')}
        </button>
      </div>
    </Modal>
  );
}
