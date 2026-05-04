import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTwilioCall } from '../../hooks/useTwilioCall';
import { subscribeToEvent } from '../../services/socket';

interface CallWidgetProps {
  contactName: string;
  contactPhone: string;
  conversationId: string;
}

export function CallWidget({
  contactName,
  contactPhone,
  conversationId,
}: CallWidgetProps) {
  const {
    status,
    formattedDuration,
    isMuted,
    isActive,
    makeCall,
    hangUp,
    toggleMute,
  } = useTwilioCall();
  const queryClient = useQueryClient();
  const [showWidget, setShowWidget] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToEvent<{ conversationId?: string }>('call:status', (data) => {
      if (data.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: ['call-history', conversationId] });
    });

    return () => unsubscribe();
  }, [conversationId, queryClient]);

  const handleCall = async () => {
    setShowWidget(true);
    await makeCall(contactPhone, conversationId);
  };

  const handleHangUp = () => {
    hangUp();
    setTimeout(() => setShowWidget(false), 2000);
  };

  const statusLabels: Record<string, string> = {
    idle: 'Pronto para ligar',
    connecting: 'Conectando...',
    ringing: 'Chamando...',
    'in-progress': formattedDuration,
    completed: 'Chamada encerrada',
    failed: 'Falha na chamada',
  };

  const statusColors: Record<string, string> = {
    idle: 'var(--txt-3)',
    connecting: 'var(--amber)',
    ringing: 'var(--amber)',
    'in-progress': 'var(--green)',
    completed: 'var(--txt-3)',
    failed: 'var(--red)',
  };

  if (!showWidget) {
    return (
      <button
        className="call-start-btn"
        onClick={() => void handleCall()}
        title={`Ligar para ${contactName}`}
        disabled={!contactPhone}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M14.5 11.5c0 .3-.1.6-.2.9-.1.3-.3.5-.5.7-.4.4-.8.6-1.3.7-.5.1-1 .1-1.5-.1-1.4-.5-2.7-1.3-3.8-2.4C6.1 10.2 5.3 8.9 4.8 7.5c-.2-.5-.2-1-.1-1.5.1-.5.3-.9.7-1.3.2-.2.4-.3.7-.4.3-.1.5-.1.8 0l.6.2c.2.1.3.2.4.4l1.2 1.7c.1.2.2.4.2.6 0 .2-.1.4-.2.6L8.5 8.1c-.1.1-.1.3-.1.4 0 .1.1.3.2.4.5.8 1.1 1.4 1.9 1.9.1.1.3.2.4.2.1 0 .3 0 .4-.1l.5-.6c.2-.2.4-.3.6-.2.2 0 .4.1.6.2l1.7 1.2c.2.1.3.3.4.5l.2.6c.1.3.1.5 0 .7.1.2 0 .4-.3.2z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        Ligar
      </button>
    );
  }

  return (
    <div className={`call-widget ${status}`}>
      <div className="call-contact">
        <div className="call-avatar">{contactName.charAt(0).toUpperCase()}</div>
        <div className="call-info">
          <span className="call-name">{contactName}</span>
          <span className="call-phone">{contactPhone}</span>
        </div>
      </div>

      <div className="call-status" style={{ color: statusColors[status] ?? 'var(--txt-3)' }}>
        <span className={`call-status-dot ${status}`} />
        {statusLabels[status] ?? 'Aguardando'}
      </div>

      {isActive && (
        <div className="call-controls">
          <button
            className={`call-ctrl-btn ${isMuted ? 'active' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'Ativar microfone' : 'Mutar microfone'}
          >
            {isMuted ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M2 2l12 12M9.5 9.7A3 3 0 016.3 6.5M8 11v2M5 13h6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
                <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M3 8c0 2.8 2.2 5 5 5s5-2.2 5-5M8 13v2M5 15h6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            )}
            <span>{isMuted ? 'Ativar mic' : 'Mutar'}</span>
          </button>

          <button className="call-ctrl-btn hangup" onClick={handleHangUp} title="Encerrar chamada">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path
                d="M16 11.7c0 .3-.1.7-.2 1-.1.3-.3.6-.6.8-.4.4-.9.7-1.4.8-.6.1-1.1.1-1.7-.1-1.6-.6-3-1.5-4.2-2.7C6.7 10.3 5.8 8.9 5.2 7.3c-.2-.6-.2-1.1-.1-1.7.1-.5.4-1 .8-1.4.2-.2.5-.4.8-.5.3-.1.6-.1.9 0l.7.2c.2.1.4.3.5.5l1.3 1.9c.1.2.2.4.2.7 0 .2-.1.5-.2.7L9.6 9c-.1.2-.1.3-.1.5 0 .2.1.3.2.5.6.9 1.3 1.6 2.2 2.2.2.1.3.2.5.2.2 0 .4 0 .5-.1l.6-.7c.2-.2.4-.3.7-.3.3 0 .5.1.7.2l1.9 1.3c.2.2.4.3.5.5v.7z"
                fill="currentColor"
              />
            </svg>
            <span>Encerrar</span>
          </button>
        </div>
      )}

      {(status === 'completed' || status === 'failed') && (
        <button className="btn-ghost btn-sm" onClick={() => setShowWidget(false)}>
          Fechar
        </button>
      )}
    </div>
  );
}
