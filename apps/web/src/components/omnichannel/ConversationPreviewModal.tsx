import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AudioPlayer } from './AudioPlayer';
import { omnichannelApi } from '../../services/api';

interface Props {
  conversationId: string;
  contactName: string;
  onClose: () => void;
  onAssign: () => void;
  isAssigning: boolean;
}

function senderLabel(senderType: string): string {
  if (senderType === 'agent') return 'Agente';
  if (senderType === 'bot') return 'Bot';
  if (senderType === 'system') return 'Sistema';
  return 'Cliente';
}

export function ConversationPreviewModal({
  conversationId,
  contactName,
  onClose,
  onAssign,
  isAssigning,
}: Props) {
  const { t, i18n } = useTranslation('omnichannel');

  const { data: page, isLoading } = useQuery({
    queryKey: ['conversation-preview-messages', conversationId],
    queryFn: () => omnichannelApi.listMessages(conversationId, { per_page: 50 }),
    staleTime: 30_000,
  });

  const messages = page?.data ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('queue.previewTitle', { name: contactName })}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        width: '100%',
        maxWidth: 600,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--txt)' }}>
              {contactName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt-2)', marginTop: 2 }}>
              {t('queue.previewSubtitle')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--txt-2)',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label={t('queue.previewClose')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Transcript */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {isLoading && (
            <div style={{ color: 'var(--txt-2)', fontSize: 13, textAlign: 'center', padding: 24 }}>
              {t('queue.previewLoading')}
            </div>
          )}

          {!isLoading && messages.length === 0 && (
            <div style={{ color: 'var(--txt-2)', fontSize: 13, textAlign: 'center', padding: 24 }}>
              {t('queue.previewEmpty')}
            </div>
          )}

          {messages.map((message) => {
            const isOutgoing = message.sender_type === 'agent' || message.sender_type === 'system';
            return (
              <div
                key={message.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isOutgoing ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--txt-2)', marginBottom: 3 }}>
                  {senderLabel(message.sender_type)}
                </div>
                <div style={{
                  background: isOutgoing ? 'var(--teal)' : 'var(--bg-3)',
                  color: isOutgoing ? '#fff' : 'var(--txt)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  maxWidth: '80%',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}>
                  {message.content_type === 'audio' && message.media_url ? (
                    <AudioPlayer src={message.media_url} isOutgoing={isOutgoing} />
                  ) : message.content_type === 'image' && message.media_url ? (
                    <img
                      src={message.media_url}
                      alt={message.content ?? 'imagem'}
                      style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, display: 'block' }}
                    />
                  ) : message.content_type === 'video' && message.media_url ? (
                    <video
                      src={message.media_url}
                      controls
                      style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, display: 'block' }}
                    />
                  ) : message.content_type === 'document' && message.media_url ? (
                    <a
                      href={message.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: isOutgoing ? '#fff' : 'var(--teal)', fontSize: 13 }}
                    >
                      {message.content ?? t('queue.previewDownload')}
                    </a>
                  ) : (
                    <span>{message.content ?? `(${message.content_type})`}</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 3 }}>
                  {new Date(message.created_at).toLocaleString(i18n.language)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          flexShrink: 0,
        }}>
          <button
            type="button"
            className="zd-btn"
            onClick={onClose}
          >
            {t('queue.previewClose')}
          </button>
          <button
            type="button"
            className="zd-btn zd-btn-primary"
            onClick={onAssign}
            disabled={isAssigning}
          >
            {isAssigning ? t('queue.assigning') : t('queue.assignMe')}
          </button>
        </div>
      </div>
    </div>
  );
}
