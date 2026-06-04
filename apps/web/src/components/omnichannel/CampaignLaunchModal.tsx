import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { campaignsApi, type Campaign } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface Props {
  campaign: Campaign;
  onClose: () => void;
  onLaunched: (campaign: Campaign) => void;
}

export function CampaignLaunchModal({ campaign, onClose, onLaunched }: Props) {
  const { t } = useTranslation('campaigns');
  const toast = useToast();
  const queryClient = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [confirmText, setConfirmText] = useState('');

  const confirmWord = t('launch.confirmWord');
  const isConfirmed = confirmText.toUpperCase() === confirmWord.toUpperCase();

  const isScheduled = Boolean(campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date());

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const launchMutation = useMutation({
    mutationFn: () => campaignsApi.launch(campaign.id),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.id] });
      toast.success(updated.status === 'scheduled' ? 'Campanha agendada com sucesso!' : 'Campanha lançada com sucesso!');
      onLaunched(updated);
    },
    onError: () => {
      toast.error('Erro ao lançar campanha. Tente novamente.');
    },
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 36,
    background: 'var(--bg-3)',
    border: `1.5px solid ${isConfirmed ? 'var(--teal)' : 'var(--line-2)'}`,
    borderRadius: 'var(--r)',
    color: 'var(--txt)',
    fontSize: 13,
    fontFamily: 'var(--mono)',
    padding: '0 12px',
    outline: 'none',
    letterSpacing: '0.08em',
    textAlign: 'center',
    boxSizing: 'border-box',
    transition: 'border-color .15s',
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('launch.title')}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'var(--backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-pop)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('launch.title')}</div>
          <button onClick={onClose} className="tb-icon-btn" aria-label="Fechar">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Warning block */}
          <div style={{
            padding: '12px 14px',
            background: 'rgba(251,191,36,.08)',
            border: '1px solid rgba(251,191,36,.2)',
            borderRadius: 'var(--r)',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M8 1.5L14.5 13.5H1.5L8 1.5z" stroke="var(--amber)" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 6v3M8 10.5v1" stroke="var(--amber)" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 12, color: 'var(--txt-2)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--txt)' }}>
                {t('launch.warningImmediate', { count: campaign.total_contacts })}
              </strong>
              <div style={{ marginTop: 6 }}>
                {isScheduled && campaign.scheduled_at
                  ? t('launch.scheduledInfo', { date: new Date(campaign.scheduled_at).toLocaleString('pt-BR') })
                  : t('launch.immediateInfo')}
              </div>
            </div>
          </div>

          {/* Campaign name */}
          <div style={{ padding: '10px 14px', background: 'var(--bg-3)', borderRadius: 'var(--r)', fontSize: 12 }}>
            <span style={{ color: 'var(--txt-3)' }}>Campanha: </span>
            <strong style={{ color: 'var(--txt)' }}>{campaign.name}</strong>
          </div>

          {/* Confirm field */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 6, textAlign: 'center' }}>
              {t('launch.typeToConfirm')}
            </div>
            <input
              autoFocus
              style={inputStyle as React.CSSProperties}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmWord}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button className="tb-btn" onClick={onClose}>Cancelar</button>
          <button
            className="tb-btn"
            disabled={!isConfirmed || launchMutation.isPending}
            onClick={() => launchMutation.mutate()}
            style={{
              background: isConfirmed ? 'var(--teal)' : 'var(--bg-4)',
              color: isConfirmed ? 'var(--bg)' : 'var(--txt-3)',
              border: 'none',
              cursor: isConfirmed ? 'pointer' : 'default',
              transition: 'all .15s',
              fontWeight: 600,
              padding: '0 16px',
            }}
          >
            {launchMutation.isPending ? t('launch.launching') : t('launch.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
