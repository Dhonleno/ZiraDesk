import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface CrmBulkDeleteConfirmModalProps {
  open: boolean;
  count: number;
  title: string;
  warning: string;
  instruction: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function CrmBulkDeleteConfirmModal({
  open,
  count,
  title,
  warning,
  instruction,
  confirmLabel,
  cancelLabel,
  loading = false,
  onConfirm,
  onCancel,
}: CrmBulkDeleteConfirmModalProps) {
  const [confirmInput, setConfirmInput] = useState('');
  const expectedValue = String(count);

  useEffect(() => {
    if (open) setConfirmInput('');
  }, [count, open]);

  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidth="sm">
      <div style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            border: '1px solid var(--red)',
            borderRadius: 'var(--r)',
            background: 'var(--red-dim)',
            color: 'var(--red)',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {warning}
        </div>

        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: 'var(--txt-2)', fontSize: 12 }}>{instruction}</span>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={confirmInput}
            onChange={(event) => setConfirmInput(event.target.value)}
            placeholder={expectedValue}
            aria-label={instruction}
            style={{
              width: '100%',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r)',
              background: 'var(--bg-3)',
              color: 'var(--txt)',
              fontFamily: 'var(--mono)',
              fontSize: 13,
              padding: '8px 11px',
              outline: 'none',
            }}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <button
            type="button"
            disabled={loading || confirmInput !== expectedValue}
            onClick={() => void onConfirm()}
            style={{
              border: '1px solid var(--red)',
              borderRadius: 'var(--r)',
              background: 'var(--red)',
              color: 'var(--bg)',
              fontFamily: 'var(--font)',
              fontSize: 12,
              fontWeight: 600,
              padding: '8px 12px',
              cursor: loading || confirmInput !== expectedValue ? 'not-allowed' : 'pointer',
              opacity: loading || confirmInput !== expectedValue ? 0.45 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
