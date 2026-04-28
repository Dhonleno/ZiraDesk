import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ConversationList } from '../../components/omnichannel/ConversationList';
import { ChatArea } from '../../components/omnichannel/ChatArea';
import { InfoPanel } from '../../components/omnichannel/InfoPanel';
import { subscribeToEvent } from '../../services/socket';

export function ConversationsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const unsubNew = subscribeToEvent<{ conversationId: string }>(
      'conversation:new_message',
      ({ conversationId }) => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      },
    );

    const unsubUpdated = subscribeToEvent<{ conversation: { id: string } }>(
      'conversation:updated',
      ({ conversation }) => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['conversation', conversation.id] });
      },
    );

    return () => {
      unsubNew();
      unsubUpdated();
    };
  }, [qc]);

  return (
    <div className="flex h-full overflow-hidden">
      <ConversationList selectedId={selectedId} onSelect={setSelectedId} />

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
            <p className="text-sm text-txt-3">Selecione uma conversa para começar</p>
          </div>
        </div>
      )}
    </div>
  );
}
