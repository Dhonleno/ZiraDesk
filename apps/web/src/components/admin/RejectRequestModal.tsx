import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';

interface RejectRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

const MIN_CHARS = 10;

export function RejectRequestModal({ isOpen, onClose, onConfirm }: RejectRequestModalProps) {
  const { t } = useTranslation('admin');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleClose() {
    if (isSubmitting) return;
    setReason('');
    setError('');
    onClose();
  }

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (trimmed.length < MIN_CHARS) {
      setError(t('lgpd.rejectModal.minCharsError'));
      textareaRef.current?.focus();
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      await onConfirm(trimmed);
      setReason('');
    } catch {
      // Error toast already shown by mutation's onError; keep modal open.
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={isOpen} onClose={handleClose} title={t('lgpd.rejectModal.title')} maxWidth="sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label
            htmlFor="reject-reason"
            style={{ display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 500, color: 'var(--txt-2)' }}
          >
            {t('lgpd.rejectModal.reasonLabel')}
          </label>
          <textarea
            id="reject-reason"
            ref={textareaRef}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError('');
            }}
            placeholder={t('lgpd.rejectModal.reasonPlaceholder')}
            rows={4}
            disabled={isSubmitting}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
              background: 'var(--bg-3)',
              border: `1px solid ${error ? 'var(--red)' : 'var(--line-2)'}`,
              borderRadius: 'var(--r)',
              color: 'var(--txt)',
              padding: '8px 10px',
              fontSize: 13,
              lineHeight: 1.5,
              transition: 'border-color 0.15s',
            }}
          />
          {error && (
            <p role="alert" style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--red)' }}>
              {error}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            style={{
              border: '1px solid var(--line-2)',
              background: 'var(--bg-4)',
              color: 'var(--txt-2)',
              borderRadius: 'var(--r)',
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {t('lgpd.rejectModal.cancelButton')}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting}
            style={{
              border: '1px solid rgba(248,113,113,.5)',
              background: 'var(--red)',
              color: '#fff',
              borderRadius: 'var(--r)',
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.65 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {isSubmitting ? '…' : t('lgpd.rejectModal.confirmButton')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
