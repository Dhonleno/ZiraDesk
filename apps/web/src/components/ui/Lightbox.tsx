import { useEffect } from 'react';

interface LightboxProps {
  open: boolean;
  imageUrl: string;
  onClose: () => void;
  downloadName?: string;
}

export function Lightbox({ open, imageUrl, onClose, downloadName = 'imagem' }: LightboxProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 20,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: '92vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <img
          src={imageUrl}
          alt="preview"
          style={{
            maxWidth: '92vw',
            maxHeight: '85vh',
            borderRadius: 8,
            objectFit: 'contain',
          }}
        />
        <a
          href={imageUrl}
          download={downloadName}
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line-2)',
            color: 'var(--txt)',
            borderRadius: 'var(--r)',
            padding: '6px 10px',
            fontSize: 12,
            textDecoration: 'none',
          }}
        >
          Download
        </a>
      </div>
    </div>
  );
}
