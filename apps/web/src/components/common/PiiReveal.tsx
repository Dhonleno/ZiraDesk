import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { contactsApi, organizationsApi } from '../../services/api';
import { usePiiPermission } from '../../hooks/usePiiPermission';

const REVEAL_DURATION_MS = 30_000;

interface PiiRevealProps {
  entityType: 'contact' | 'organization';
  entityId: string;
  maskedValue: string | null;
  fullValue?: string | null;
  onRevealed?: () => void;
}

export function PiiReveal({ entityType, entityId, maskedValue, fullValue, onRevealed }: PiiRevealProps) {
  const { t } = useTranslation('common');
  const { hasFullPii } = usePiiPermission();
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  function startRevealTimer() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    setSecondsLeft(Math.round(REVEAL_DURATION_MS / 1000));

    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    hideTimerRef.current = setTimeout(() => {
      setRevealed(false);
      setSecondsLeft(0);
      if (countdownRef.current) clearInterval(countdownRef.current);
    }, REVEAL_DURATION_MS);
  }

  async function handleReveal() {
    if (!hasFullPii || loading || revealed) return;
    setLoading(true);
    try {
      if (entityType === 'contact') {
        await contactsApi.revealPii(entityId);
      } else {
        await organizationsApi.revealPii(entityId);
      }
      setRevealed(true);
      startRevealTimer();
      onRevealed?.();
    } catch {
      // error handled by caller's toast if needed
    } finally {
      setLoading(false);
    }
  }

  const displayValue = revealed && fullValue != null ? fullValue : (maskedValue ?? '—');
  const tooltipText = !hasFullPii
    ? t('pii.noPermission')
    : revealed
      ? t('pii.revealTimeRemaining', { seconds: secondsLeft })
      : t('pii.maskedHint');

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span>{displayValue}</span>
      <button
        type="button"
        title={tooltipText}
        aria-label={tooltipText}
        disabled={!hasFullPii || loading || revealed}
        onClick={() => void handleReveal()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 2,
          border: 'none',
          background: 'none',
          cursor: !hasFullPii || revealed ? 'not-allowed' : loading ? 'wait' : 'pointer',
          color: !hasFullPii ? 'var(--txt-3)' : revealed ? 'var(--teal)' : 'var(--txt-2)',
          opacity: loading ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        {revealed ? (
          // eye-open icon (revealed)
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
        ) : (
          // eye-closed icon (masked)
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 2l12 12M6.5 6.7A2 2 0 0 0 10 10M4.4 4.6C2.8 5.6 1.5 7.3 1 8c1.2 2.3 3.7 5 7 5 1.3 0 2.5-.4 3.5-1M7 3.1C7.3 3 7.7 3 8 3c3.3 0 5.8 2.7 7 5-.4.8-1 1.7-1.7 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        )}
      </button>
    </span>
  );
}
