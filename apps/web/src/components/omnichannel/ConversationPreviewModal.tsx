import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AudioPlayer } from './AudioPlayer';
import { omnichannelApi } from '../../services/api';
import { useMediaUrl } from '../../hooks/useMediaUrl';

interface Props {
  conversationId: string;
  contactName: string;
  onClose: () => void;
  onAssign: () => void;
  isAssigning: boolean;
  primaryLabel?: string;
}

function senderLabel(senderType: string, senderName?: string | null): string {
  if (senderName) return senderName;
  if (senderType === 'agent') return 'Agente';
  if (senderType === 'bot') return 'Bot';
  if (senderType === 'system') return 'Sistema';
  return 'Cliente';
}

function PreviewMediaLoading() {
  const { t } = useTranslation('omnichannel');

  return (
    <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>
      {t('queue.previewLoadingMedia')}
    </span>
  );
}

function PreviewAudio({
  mediaId,
  conversationId,
  isOutgoing,
}: {
  mediaId: string;
  conversationId: string;
  isOutgoing: boolean;
}) {
  const blobUrl = useMediaUrl(mediaId, conversationId);

  if (!blobUrl) return <PreviewMediaLoading />;
  return <AudioPlayer src={blobUrl} isOutgoing={isOutgoing} />;
}

function PreviewImage({
  mediaId,
  conversationId,
  alt,
}: {
  mediaId: string;
  conversationId: string;
  alt: string;
}) {
  const blobUrl = useMediaUrl(mediaId, conversationId);

  if (!blobUrl) return <PreviewMediaLoading />;
  return (
    <img
      src={blobUrl}
      alt={alt}
      style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, display: 'block' }}
    />
  );
}

function PreviewVideo({
  mediaId,
  conversationId,
}: {
  mediaId: string;
  conversationId: string;
}) {
  const blobUrl = useMediaUrl(mediaId, conversationId);

  if (!blobUrl) return <PreviewMediaLoading />;
  return (
    <video
      src={blobUrl}
      controls
      style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, display: 'block' }}
    />
  );
}

function PreviewDocument({
  mediaId,
  conversationId,
  label,
  isOutgoing,
}: {
  mediaId: string;
  conversationId: string;
  label: string;
  isOutgoing: boolean;
}) {
  const blobUrl = useMediaUrl(mediaId, conversationId);

  if (!blobUrl) return <PreviewMediaLoading />;
  return (
    <a
      href={blobUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: isOutgoing ? '#fff' : 'var(--teal)', fontSize: 13 }}
    >
      {label}
    </a>
  );
}

export function ConversationPreviewModal({
  conversationId,
  contactName,
  onClose,
  onAssign,
  isAssigning,
  primaryLabel,
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
                  {senderLabel(message.sender_type, message.sender_name)}
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
                    <PreviewAudio
                      mediaId={message.media_url}
                      conversationId={conversationId}
                      isOutgoing={isOutgoing}
                    />
                  ) : message.content_type === 'image' && message.media_url ? (
                    <PreviewImage
                      mediaId={message.media_url}
                      conversationId={conversationId}
                      alt={message.content ?? 'imagem'}
                    />
                  ) : message.content_type === 'video' && message.media_url ? (
                    <PreviewVideo
                      mediaId={message.media_url}
                      conversationId={conversationId}
                    />
                  ) : message.content_type === 'document' && message.media_url ? (
                    <PreviewDocument
                      mediaId={message.media_url}
                      conversationId={conversationId}
                      label={message.content ?? t('queue.previewDownload')}
                      isOutgoing={isOutgoing}
                    />
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
            {isAssigning ? t('queue.assigning') : (primaryLabel ?? t('queue.assignMe'))}
          </button>
        </div>
      </div>
    </div>
  );
}
