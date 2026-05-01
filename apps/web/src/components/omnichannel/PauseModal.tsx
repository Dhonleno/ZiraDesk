import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface PauseModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: { reason: string; notes?: string }) => Promise<void>;
  isSubmitting?: boolean;
}

export function PauseModal({ open, onClose, onConfirm, isSubmitting = false }: PauseModalProps) {
  const { t } = useTranslation('admin');
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ['pause-reasons'],
    queryFn: adminApi.pauseReasons.list,
    enabled: open,
  });

  const activeReasons = useMemo(
    () => reasons.filter((reason) => reason.is_active),
    [reasons],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedReason(null);
    setNotes('');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('tenantAdmin.pause.title')} maxWidth="sm">
      <div style={{ display: 'grid', gap: 14 }}>
        <p style={{ margin: 0, color: 'var(--txt-2)', fontSize: 13 }}>
          {t('tenantAdmin.pause.selectReason')}
        </p>

        {isLoading ? (
          <div className="pause-reasons-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                style={{
                  height: 78,
                  borderRadius: 'var(--r-lg)',
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-3)',
                  opacity: 0.55,
                }}
              />
            ))}
          </div>
        ) : (
          <div className="pause-reasons-grid">
            {activeReasons.map((reason) => (
              <button
                key={reason.id}
                type="button"
                className={`pause-reason-btn ${selectedReason === reason.label ? 'active' : ''}`}
                onClick={() => setSelectedReason(reason.label)}
              >
                <span className="pause-icon">{reason.icon}</span>
                <span>{reason.label}</span>
              </button>
            ))}
          </div>
        )}

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: 'var(--txt-2)', fontSize: 12 }}>{t('tenantAdmin.pause.notes')}</span>
          <textarea
            className="pause-notes"
            placeholder={t('tenantAdmin.pause.notes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={500}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!selectedReason) return;
              const payload: { reason: string; notes?: string } = {
                reason: selectedReason,
              };
              const normalizedNotes = notes.trim();
              if (normalizedNotes) {
                payload.notes = normalizedNotes;
              }
              void onConfirm(payload);
            }}
            loading={isSubmitting}
            disabled={!selectedReason || isSubmitting}
          >
            {t('tenantAdmin.pause.start')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
