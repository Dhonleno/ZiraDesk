import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { omnichannelApi, type OmnichannelMessage } from '../../services/api';
import { Lightbox } from '../ui/Lightbox';

interface MessageMediaProps {
  message: OmnichannelMessage;
  conversationId: string;
  localMediaUrl?: string | undefined;
}

function revokeBlobUrlLater(url: string, delayMs = 1500) {
  if (!url.startsWith('blob:')) return;
  if (import.meta.env.DEV) return;
  window.setTimeout(() => URL.revokeObjectURL(url), delayMs);
}

function getMetadataMediaId(metadata: OmnichannelMessage['metadata']): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const mediaId = (metadata as Record<string, unknown>).media_id;
  return typeof mediaId === 'string' && mediaId.trim().length > 0 ? mediaId : null;
}

export function MessageMedia({ message, conversationId, localMediaUrl }: MessageMediaProps) {
  const { t } = useTranslation('omnichannel');
  const [openLightbox, setOpenLightbox] = useState(false);
  const [ignoreLocalMediaUrl, setIgnoreLocalMediaUrl] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const messageMediaUrl = message.media_url?.trim() || null;
  const metadataMediaId = getMetadataMediaId(message.metadata);
  const mediaId = messageMediaUrl ?? metadataMediaId;
  const effectiveLocalMediaUrl = ignoreLocalMediaUrl ? undefined : localMediaUrl;

  useEffect(() => {
    setIgnoreLocalMediaUrl(false);
  }, [localMediaUrl, message.id]);

  const handleMediaError = useCallback(() => {
    if (!effectiveLocalMediaUrl) return;
    setIgnoreLocalMediaUrl(true);
  }, [effectiveLocalMediaUrl]);

  const { data: mediaBlob, isLoading, isError } = useQuery({
    queryKey: ['omnichannel-media', conversationId, mediaId],
    queryFn: () => omnichannelApi.downloadMedia(mediaId!, conversationId),
    enabled: Boolean(mediaId) && !effectiveLocalMediaUrl,
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    setMediaUrl((prev) => {
      if (prev && prev.startsWith('blob:')) {
        revokeBlobUrlLater(prev);
      }
      if (effectiveLocalMediaUrl) return effectiveLocalMediaUrl;
      if (!mediaBlob) return null;
      return URL.createObjectURL(mediaBlob);
    });
  }, [effectiveLocalMediaUrl, mediaBlob]);

  useEffect(() => {
    return () => {
      if (mediaUrl && mediaUrl.startsWith('blob:')) {
        revokeBlobUrlLater(mediaUrl);
      }
    };
  }, [mediaUrl]);

  if (!mediaId && !effectiveLocalMediaUrl) return null;

  if (isLoading && !mediaUrl) {
    return <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>{t('history.loading')}</div>;
  }

  if (isError && !mediaUrl) {
    return (
      <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
        {t('media.unavailable', { defaultValue: 'Mídia indisponível' })}
      </div>
    );
  }

  if (!mediaUrl) return null;

  if (message.content_type === 'image') {
    return (
      <>
        <img
          src={mediaUrl}
          alt="image"
          onError={handleMediaError}
          onClick={() => setOpenLightbox(true)}
          style={{ maxWidth: 240, borderRadius: 8, cursor: 'pointer', display: 'block' }}
        />
        <Lightbox open={openLightbox} imageUrl={mediaUrl} onClose={() => setOpenLightbox(false)} />
      </>
    );
  }

  if (message.content_type === 'audio') {
    return (
      <audio controls src={mediaUrl} onError={handleMediaError} style={{ maxWidth: 240 }} />
    );
  }

  if (message.content_type === 'video') {
    return (
      <video controls src={mediaUrl} onError={handleMediaError} style={{ maxWidth: 240, borderRadius: 8 }} />
    );
  }

  if (message.content_type === 'document') {
    const fileName =
      (typeof message.metadata === 'object' && message.metadata && 'filename' in message.metadata
        ? String((message.metadata as { filename?: string }).filename)
        : null) || 'documento';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>📄</span>
        <a href={mediaUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
          {fileName}
        </a>
      </div>
    );
  }

  return null;
}
