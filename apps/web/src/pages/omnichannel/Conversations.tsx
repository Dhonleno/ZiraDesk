import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ConversationList } from '../../components/omnichannel/ConversationList';
import { ChatArea } from '../../components/omnichannel/ChatArea';
import { InfoPanel } from '../../components/omnichannel/InfoPanel';
import { CreateConversationModal } from '../../components/omnichannel/CreateConversationModal';
import { ActiveOutboundModal } from '../../components/omnichannel/ActiveOutboundModal';
import { PageShell } from '../../components/layout/PageShell';
import { subscribeToEvent } from '../../services/socket';
import { notificationsApi } from '../../services/api';

export function ConversationsPage() {
  const { t } = useTranslation('omnichannel');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showActiveOutboundModal, setShowActiveOutboundModal] = useState(false);
  const [searchParams] = useSearchParams();
  const [filterAgentId, setFilterAgentId] = useState('');
  const qc = useQueryClient();

  const markConversationNotificationsRead = useCallback((conversationId: string) => {
    void notificationsApi.markConversationRead(conversationId)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      })
      .catch(() => {
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      });
  }, [qc]);

  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    const agentIdFromUrl = searchParams.get('agent_id');
    if (conversationId) setSelectedId(conversationId);
    setFilterAgentId(agentIdFromUrl ?? '');
  }, [searchParams]);

  useEffect(() => {
    if (!selectedId) return;
    markConversationNotificationsRead(selectedId);
  }, [markConversationNotificationsRead, selectedId]);

  useEffect(() => {
    const handleOpenModal = () => setShowModal(true);
    const handleOpenActiveOutboundModal = () => setShowActiveOutboundModal(true);
    window.addEventListener('omnichannel:open-modal', handleOpenModal);
    window.addEventListener('omnichannel:open-active-outbound-modal', handleOpenActiveOutboundModal);
    return () => {
      window.removeEventListener('omnichannel:open-modal', handleOpenModal);
      window.removeEventListener('omnichannel:open-active-outbound-modal', handleOpenActiveOutboundModal);
    };
  }, []);

  useEffect(() => {
    const unsubNew = subscribeToEvent<{ conversationId: string }>(
      'conversation:new_message',
      ({ conversationId }) => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
        if (conversationId === selectedId) {
          markConversationNotificationsRead(conversationId);
        }
      },
    );

    const unsubNotification = subscribeToEvent<{ conversationId?: string; type?: string }>(
      'notification:new',
      ({ conversationId, type }) => {
        if (conversationId !== selectedId) return;
        if (
          type !== 'conversation.message'
          && type !== 'conversation_message'
          && type !== 'conversation.assigned'
          && type !== 'conversation_assigned'
        ) return;

        markConversationNotificationsRead(conversationId);
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
      unsubNotification();
      unsubUpdated();
      unsubCreated();
      unsubTagAdded();
      unsubTagRemoved();
    };
  }, [markConversationNotificationsRead, qc, selectedId]);

  return (
    <PageShell padding={0} contentStyle={{ overflowX: 'hidden', overflowY: 'hidden' }}>
      <div
        className="h-full w-full"
        style={{
          display: 'grid',
          gridTemplateColumns: '320px minmax(0, 1fr) 360px',
          overflowX: 'hidden',
          overflowY: 'hidden',
        }}
      >
        <ConversationList
          selectedId={selectedId}
          onSelect={setSelectedId}
          initialAgentId={filterAgentId}
        />

        {selectedId ? (
          <>
            <div style={{ minWidth: 0, display: 'flex', overflow: 'hidden' }}>
              <ChatArea conversationId={selectedId} onClosed={() => setSelectedId(null)} />
            </div>
            <InfoPanel conversationId={selectedId} />
          </>
        ) : (
          <div className="flex items-center justify-center" style={{ gridColumn: '2 / 4' }}>
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

        {showActiveOutboundModal && (
          <ActiveOutboundModal
            onClose={() => setShowActiveOutboundModal(false)}
            onCreated={(id) => setSelectedId(id)}
          />
        )}
      </div>
    </PageShell>
  );
}
