import { useEffect, useState } from 'react';
import { omnichannelApi } from '../services/api';

function isDirectMediaUrl(mediaId: string): boolean {
  return mediaId.startsWith('http') || mediaId.startsWith('blob:') || mediaId.startsWith('/');
}

export function useMediaUrl(
  mediaId: string | null | undefined,
  conversationId: string,
): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    setBlobUrl(null);
    if (!mediaId) return undefined;

    if (isDirectMediaUrl(mediaId)) {
      setBlobUrl(mediaId);
      return undefined;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    omnichannelApi
      .downloadMedia(mediaId, conversationId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId, conversationId]);

  return blobUrl;
}
