import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ResolvePayload {
  csat_score?: number;
  csat_comment?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: ResolvePayload) => Promise<void>;
  isSubmitting: boolean;
}

const EMOJIS = ['😞', '😕', '😐', '😊', '😄'] as const;

export function ResolveModal({ open, onClose, onConfirm, isSubmitting }: Props) {
  const { t } = useTranslation('omnichannel');
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!open) return;
    setRating(0);
    setComment('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  const ratingLabel = rating > 0 ? t(`resolve.ratings.${rating}`) : '';

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
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>{t('resolve.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2 }}>{t('resolve.subtitle')}</div>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              {t('resolve.csatLabel')}
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {EMOJIS.map((emoji, index) => {
                const value = index + 1;
                const selected = rating === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 'var(--r)',
                      border: selected ? '1px solid var(--teal)' : '1px solid var(--line-2)',
                      background: selected ? 'var(--teal-dim)' : 'var(--bg-3)',
                      cursor: 'pointer',
                      fontSize: 22,
                      transition: 'all .15s',
                    }}
                    aria-label={`${value} ${t(`resolve.ratings.${value}`)}`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>

            {rating > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--teal)', fontWeight: 500 }}>
                {rating} ★ {ratingLabel}
              </div>
            )}
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
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={t('resolve.commentPlaceholder')}
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
              disabled={isSubmitting}
              onClick={() => {
                const payload: ResolvePayload = {};
                if (rating > 0) payload.csat_score = rating;
                if (comment.trim()) payload.csat_comment = comment.trim();
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
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {t('resolve.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
