import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { omnichannelApi, type OmnichannelMessage } from '../../services/api';
import { Lightbox } from '../ui/Lightbox';

interface MessageMediaProps {
  message: OmnichannelMessage;
  conversationId: string;
  localMediaUrl?: string | undefined;
}

function getMetadataMediaId(metadata: OmnichannelMessage['metadata']): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const mediaId = (metadata as Record<string, unknown>).media_id;
  return typeof mediaId === 'string' && mediaId.trim().length > 0 ? mediaId : null;
}

export function MessageMedia({ message, conversationId, localMediaUrl }: MessageMediaProps) {
  const { t } = useTranslation('omnichannel');
  const [openLightbox, setOpenLightbox] = useState(false);
  const mediaId = message.media_url ?? getMetadataMediaId(message.metadata);

  const { data: mediaBlob, isLoading, isError } = useQuery({
    queryKey: ['omnichannel-media', conversationId, mediaId],
    queryFn: () => omnichannelApi.downloadMediaById(mediaId!),
    enabled: Boolean(mediaId) && !localMediaUrl,
    staleTime: 60 * 60 * 1000,
  });

  const mediaUrl = useMemo(() => {
    if (localMediaUrl) return localMediaUrl;
    if (!mediaBlob) return null;
    return URL.createObjectURL(mediaBlob);
  }, [localMediaUrl, mediaBlob]);

  useEffect(() => {
    return () => {
      if (mediaUrl && !localMediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [localMediaUrl, mediaUrl]);

  if (!mediaId && !localMediaUrl) return null;

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
          onClick={() => setOpenLightbox(true)}
          style={{ maxWidth: 240, borderRadius: 8, cursor: 'pointer', display: 'block' }}
        />
        <Lightbox open={openLightbox} imageUrl={mediaUrl} onClose={() => setOpenLightbox(false)} />
      </>
    );
  }

  if (message.content_type === 'audio') {
    return (
      <audio controls style={{ maxWidth: 240 }}>
        <source src={mediaUrl} />
      </audio>
    );
  }

  if (message.content_type === 'video') {
    return (
      <video controls style={{ maxWidth: 240, borderRadius: 8 }}>
        <source src={mediaUrl} />
      </video>
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
