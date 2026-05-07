import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { omnichannelApi } from '../../services/api';

export interface ResolvePayload {
  csatMode: 'resolve' | 'close';
  closeTypeId: string;
  closeOutcomeId: string;
  internalNote?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: ResolvePayload) => Promise<void>;
  isSubmitting: boolean;
}

export function ResolveModal({ open, onClose, onConfirm, isSubmitting }: Props) {
  const { t } = useTranslation('omnichannel');
  const [csatMode, setCsatMode] = useState<'resolve' | 'close'>('resolve');
  const [closeTypeId, setCloseTypeId] = useState('');
  const [closeOutcomeId, setCloseOutcomeId] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const closeConfigQuery = useQuery({
    queryKey: ['omnichannel', 'close-config'],
    queryFn: omnichannelApi.getCloseConfig,
    enabled: open,
  });

  const typeOptions = closeConfigQuery.data?.types ?? [];
  const outcomeOptions = closeConfigQuery.data?.outcomes ?? [];
  const isConfigReady = typeOptions.length > 0 && outcomeOptions.length > 0;

  useEffect(() => {
    if (!open) return;
    setCsatMode('resolve');
    setInternalNote('');
  }, [open]);

  useEffect(() => {
    if (!open || !isConfigReady) return;
    setCloseTypeId((previous) => previous || typeOptions[0]!.id);
    setCloseOutcomeId((previous) => previous || outcomeOptions[0]!.id);
  }, [open, isConfigReady, typeOptions, outcomeOptions]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  const canConfirm = isConfigReady && closeTypeId.length > 0 && closeOutcomeId.length > 0 && !isSubmitting;
  const modeDescription = {
    resolve: t('chat.resolveHint', { defaultValue: 'Encerrar com registro de CSAT' }),
    close: t('chat.closeDirectHint', { defaultValue: 'Encerrar imediatamente, sem coleta de CSAT' }),
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'var(--backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>
            {t('chat.end', { defaultValue: 'Encerrar atendimento' })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2 }}>
            {t('resolve.subtitle', { defaultValue: 'Escolha como finalizar este atendimento' })}
          </div>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <button
              type="button"
              onClick={() => setCsatMode('resolve')}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 'var(--r)',
                border: csatMode === 'resolve' ? '1px solid var(--teal)' : '1px solid var(--line-2)',
                background: csatMode === 'resolve' ? 'var(--teal-dim)' : 'var(--bg-3)',
                color: csatMode === 'resolve' ? 'var(--teal)' : 'var(--txt-2)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {t('chat.resolve', { defaultValue: 'Resolver' })}
              </div>
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.9 }}>
                {modeDescription.resolve}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setCsatMode('close')}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 'var(--r)',
                border: csatMode === 'close' ? '1px solid var(--teal)' : '1px solid var(--line-2)',
                background: csatMode === 'close' ? 'var(--teal-dim)' : 'var(--bg-3)',
                color: csatMode === 'close' ? 'var(--teal)' : 'var(--txt-2)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {t('chat.close', { defaultValue: 'Fechar' })}
              </div>
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.9 }}>
                {modeDescription.close}
              </div>
            </button>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--txt-2)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                }}
              >
                {t('resolve.closeTypeLabel', { defaultValue: 'Tipo de atendimento' })}
              </label>
              <select
                value={closeTypeId}
                onChange={(event) => setCloseTypeId(event.target.value)}
                disabled={!isConfigReady || closeConfigQuery.isLoading || isSubmitting}
                style={{
                  width: '100%',
                  height: 36,
                  background: 'var(--bg-3)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  color: 'var(--txt)',
                  fontFamily: 'var(--font)',
                  fontSize: 13,
                  padding: '0 10px',
                  outline: 'none',
                }}
              >
                {typeOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: 'var(--txt-2)',
                    marginBottom: 8,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    fontWeight: 600,
                  }}
                >
                  {t('resolve.closeOutcomeLabel', { defaultValue: 'Desfecho' })}
                </label>
                <select
                  value={closeOutcomeId}
                  onChange={(event) => setCloseOutcomeId(event.target.value)}
                  disabled={!isConfigReady || closeConfigQuery.isLoading || isSubmitting}
                  style={{
                    width: '100%',
                    height: 36,
                    background: 'var(--bg-3)',
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r)',
                    color: 'var(--txt)',
                    fontFamily: 'var(--font)',
                    fontSize: 13,
                    padding: '0 10px',
                    outline: 'none',
                  }}
                >
                  {outcomeOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--txt-2)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                }}
              >
                {t('resolve.commentLabel')}
              </label>
              <textarea
                rows={3}
                value={internalNote}
                onChange={(event) => setInternalNote(event.target.value)}
                placeholder={t('resolve.commentPlaceholder')}
                maxLength={4000}
                style={{
                  width: '100%',
                  background: 'var(--bg-3)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  color: 'var(--txt)',
                  fontFamily: 'var(--font)',
                  fontSize: 13,
                  padding: '10px 12px',
                  resize: 'vertical',
                  outline: 'none',
                  minHeight: 82,
                }}
              />
            </div>
          </div>

          {open && !closeConfigQuery.isLoading && !isConfigReady && (
            <div style={{ fontSize: 12, color: 'var(--amber)' }}>
              {t('resolve.closeConfigEmpty', { defaultValue: 'Nenhuma opção ativa de tipo/desfecho disponível.' })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)',
                background: 'var(--bg-4)',
                color: 'var(--txt-2)',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'var(--font)',
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              {t('resolve.cancel', { defaultValue: 'Cancelar' })}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => {
                const payload: ResolvePayload = {
                  csatMode,
                  closeTypeId,
                  closeOutcomeId,
                  ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
                };
                void onConfirm(payload);
              }}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: '#0E1A18',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--font)',
                opacity: canConfirm ? 1 : 0.7,
              }}
            >
              {csatMode === 'resolve'
                ? t('resolve.confirm')
                : t('chat.close', { defaultValue: 'Fechar' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
