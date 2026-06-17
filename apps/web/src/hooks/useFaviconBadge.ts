import { useEffect } from 'react';

const FAVICON_SIZE = 32;
const BADGE_COLOR = '#F87171';

function updateFaviconBadge(hasUnread: boolean): void {
  if (typeof document === 'undefined') return;

  const canvas = document.createElement('canvas');
  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  img.src = '/favicon.svg';
  img.onload = () => {
    ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
    ctx.drawImage(img, 0, 0, FAVICON_SIZE, FAVICON_SIZE);

    if (hasUnread) {
      ctx.beginPath();
      ctx.arc(26, 6, 6, 0, 2 * Math.PI);
      ctx.fillStyle = BADGE_COLOR;
      ctx.fill();
    }

    const link =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      ?? Object.assign(document.createElement('link'), { rel: 'icon' });

    link.type = 'image/png';
    link.href = canvas.toDataURL('image/png');
    document.head.appendChild(link);
  };
}

export function useFaviconBadge(hasUnread: boolean): void {
  useEffect(() => {
    updateFaviconBadge(hasUnread);
  }, [hasUnread]);
}
