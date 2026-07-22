import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg';
  maxWidthPx?: number;
  closeLabel?: string;
}

const widthBySize: Record<NonNullable<ModalProps['maxWidth']>, number> = {
  sm: 420,
  md: 560,
  lg: 720,
};

export function Modal({ open, onClose, title, children, maxWidth = 'md', maxWidthPx, closeLabel }: ModalProps) {
  const { t } = useTranslation('common');
  const resolvedCloseLabel = closeLabel ?? t('close');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'var(--backdrop)',
        }}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="modal-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: maxWidthPx ?? widthBySize[maxWidth],
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '90vh',
          borderRadius: 'var(--r-xl)',
          border: '1px solid var(--line)',
          background: 'var(--bg-2)',
          boxShadow: 'var(--shadow-pop)',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--line)',
            padding: '16px 24px',
          }}
        >
          <h2 id="modal-title" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--txt)' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              borderRadius: 'var(--r)',
              padding: 4,
              color: 'var(--txt-3)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label={resolvedCloseLabel}
          >
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          className="modal-body"
          style={{
            padding: '20px 24px',
            maxHeight: 'calc(100vh - 200px)',
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--bg-5) transparent',
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
