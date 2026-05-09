import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ConversationList } from '../../components/omnichannel/ConversationList';
import { ChatArea } from '../../components/omnichannel/ChatArea';
import { InfoPanel } from '../../components/omnichannel/InfoPanel';
import { CreateConversationModal } from '../../components/omnichannel/CreateConversationModal';
import { PageShell } from '../../components/layout/PageShell';
import { subscribeToEvent } from '../../services/socket';

export function ConversationsPage() {
  const { t } = useTranslation('omnichannel');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [searchParams] = useSearchParams();
  const [filterAgentId, setFilterAgentId] = useState('');
  const qc = useQueryClient();

  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    const agentIdFromUrl = searchParams.get('agent_id');
    if (conversationId) setSelectedId(conversationId);
    setFilterAgentId(agentIdFromUrl ?? '');
  }, [searchParams]);

  useEffect(() => {
    const handleOpenModal = () => setShowModal(true);
    window.addEventListener('omnichannel:open-modal', handleOpenModal);
    return () => window.removeEventListener('omnichannel:open-modal', handleOpenModal);
  }, []);

  useEffect(() => {
    const unsubNew = subscribeToEvent<{ conversationId: string }>(
      'conversation:new_message',
      ({ conversationId }) => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      },
    );

    const unsubUpdated = subscribeToEvent<{ conversationId?: string; conversation?: { id: string } }>(
      'conversation:updated',
      ({ conversationId, conversation }) => {
        const id = conversationId ?? conversation?.id;
        if (!id) return;
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['conversation', id] });
      },
    );

    const unsubCreated = subscribeToEvent<{ conversation: { id: string } }>(
      'conversation:created',
      () => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
      },
    );

    const unsubTagAdded = subscribeToEvent<{ conversationId: string }>(
      'conversation:tag_added',
      ({ conversationId }) => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['conversation-tags', conversationId] });
      },
    );

    const unsubTagRemoved = subscribeToEvent<{ conversationId: string }>(
      'conversation:tag_removed',
      ({ conversationId }) => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['conversation-tags', conversationId] });
      },
    );

    return () => {
      unsubNew();
      unsubUpdated();
      unsubCreated();
      unsubTagAdded();
      unsubTagRemoved();
    };
  }, [qc]);

  return (
    <PageShell padding={0} contentStyle={{ overflowX: 'visible', overflowY: 'hidden' }}>
      <div className="flex h-full" style={{ overflowX: 'visible', overflowY: 'hidden' }}>
        <ConversationList
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNew={() => setShowModal(true)}
          initialAgentId={filterAgentId}
        />

        {selectedId ? (
          <>
            <ChatArea conversationId={selectedId} />
            <InfoPanel conversationId={selectedId} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-3 flex justify-center">
                <svg viewBox="0 0 24 24" fill="none" className="h-12 w-12 text-txt-3" aria-hidden>
                  <path
                    d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('noSelection')}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>{t('noSelectionSub')}</p>
            </div>
          </div>
        )}

        {showModal && (
          <CreateConversationModal
            onClose={() => setShowModal(false)}
            onCreated={(id) => setSelectedId(id)}
          />
        )}
      </div>
    </PageShell>
  );
}
