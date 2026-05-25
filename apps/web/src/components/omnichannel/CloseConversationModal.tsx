import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { omnichannelApi } from '../../services/api';

interface CloseConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: { reason: string; notes?: string; closeTypeId?: string; closeOutcomeId?: string }) => Promise<void>;
  isLoading?: boolean;
}

export function CloseConversationModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
}: CloseConversationModalProps) {
  const { t } = useTranslation('omnichannel');
  const [closeTypeId, setCloseTypeId] = useState('');
  const [closeOutcomeId, setCloseOutcomeId] = useState('');
  const [notes, setNotes] = useState('');
  const closeConfigQuery = useQuery({
    queryKey: ['omnichannel', 'close-config'],
    queryFn: omnichannelApi.getCloseConfig,
    enabled: isOpen,
  });

  const typeOptions = closeConfigQuery.data?.types ?? [];
  const outcomeOptions = closeConfigQuery.data?.outcomes ?? [];
  const hasCloseConfig = typeOptions.length > 0 && outcomeOptions.length > 0;
  const selectedType = typeOptions.find((item) => item.id === closeTypeId);
  const canConfirm = hasCloseConfig && closeTypeId.length > 0 && closeOutcomeId.length > 0 && !isLoading;

  useEffect(() => {
    if (!isOpen) return;
    setCloseTypeId('');
    setCloseOutcomeId('');
    setNotes('');
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!canConfirm || !selectedType) return;
    await onConfirm({
      reason: selectedType.label,
      closeTypeId,
      closeOutcomeId,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isLoading) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'var(--backdrop)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-conversation-title"
        style={{
          width: 'min(460px, 100%)',
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--line-2)',
          background: 'var(--bg-2)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '14px 16px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <h2
            id="close-conversation-title"
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--txt)',
            }}
          >
            {t('closeModal.title')}
          </h2>
          <button
            type="button"
            className="tb-icon-btn"
            onClick={onClose}
            disabled={isLoading}
            aria-label={t('closeModal.cancel')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div style={{ display: 'grid', gap: 12, padding: 16 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-2)' }}>
              {t('closeModal.typeLabel', { defaultValue: t('closeModal.reasonLabel') })}
            </span>
            <select
              className="filter-select"
              value={closeTypeId}
              onChange={(event) => setCloseTypeId(event.target.value)}
              disabled={isLoading || closeConfigQuery.isLoading}
              required
              style={{ width: '100%', height: 36 }}
            >
              <option value="">{t('closeModal.reasonPlaceholder')}</option>
              {typeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-2)' }}>
              {t('closeModal.outcomeLabel', { defaultValue: 'Desfecho' })}
            </span>
            <select
              className="filter-select"
              value={closeOutcomeId}
              onChange={(event) => setCloseOutcomeId(event.target.value)}
              disabled={isLoading || closeConfigQuery.isLoading}
              required
              style={{ width: '100%', height: 36 }}
            >
              <option value="">{t('closeModal.outcomePlaceholder', { defaultValue: 'Selecione o desfecho...' })}</option>
              {outcomeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {closeConfigQuery.isLoading && (
            <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>
              {t('closeModal.loadingConfig', { defaultValue: 'Carregando motivos de encerramento...' })}
            </span>
          )}

          {!closeConfigQuery.isLoading && !hasCloseConfig && (
            <span style={{ fontSize: 12, color: 'var(--amber)' }}>
              {t('closeModal.emptyConfig', { defaultValue: 'Nenhum motivo de encerramento ativo foi encontrado.' })}
            </span>
          )}

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-2)' }}>
              {t('closeModal.notesLabel')}
            </span>
            <textarea
              className="zd-textarea"
              value={notes}
              onChange={(event) => setNotes(event.target.value.slice(0, 1000))}
              disabled={isLoading}
              maxLength={1000}
              rows={5}
              placeholder={t('closeModal.notesPlaceholder')}
              style={{ resize: 'vertical', minHeight: 110 }}
            />
            <span style={{ justifySelf: 'end', fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
              {notes.length} / 1000
            </span>
          </label>
        </div>

        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 16px',
            borderTop: '1px solid var(--line)',
          }}
        >
          <button type="button" className="tb-btn" onClick={onClose} disabled={isLoading}>
            {t('closeModal.cancel')}
          </button>
          <button
            type="button"
            className="tb-btn tb-btn-primary"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
            style={{
              background: 'var(--red)',
              borderColor: 'var(--red)',
              color: 'var(--on-teal)',
              fontWeight: 600,
              opacity: canConfirm ? 1 : 0.6,
              cursor: canConfirm ? 'pointer' : 'not-allowed',
            }}
          >
            {t('closeModal.confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}
