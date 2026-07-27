import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ticketsApi, type PublicTenantSettings, type Ticket } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { Modal } from '../ui/Modal';

interface Props {
  ticket: Ticket;
  settings: PublicTenantSettings | null | undefined;
  onClose: () => void;
  onSuccess: (updated: Ticket) => void;
}

type TargetLevel = 'N2' | 'N3';

// Só escala para cima: sem nível ou N1 → N2; N2 → N3; N3 não escala.
export function availableEscalationLevels(current: Ticket['level']): TargetLevel[] {
  if (current === 'N3') return [];
  if (current === 'N2') return ['N3'];
  return ['N2'];
}

export function EscalateTicketModal({ ticket, settings, onClose, onSuccess }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();

  const options = availableEscalationLevels(ticket.level ?? null);
  const [level, setLevel] = useState<TargetLevel | ''>(options[0] ?? '');

  const levelLabel = (target: TargetLevel): string => {
    const configured = target === 'N2'
      ? settings?.support_level_n2_label
      : settings?.support_level_n3_label;
    return configured && configured !== target ? `${target} — ${configured}` : target;
  };

  const mutation = useMutation({
    mutationFn: () => ticketsApi.escalate(ticket.id, level as TargetLevel),
    onSuccess: (updated) => {
      toast.success(t('tickets.escalate.success'));
      onSuccess(updated);
      onClose();
    },
    onError: () => toast.error(t('tickets.escalate.error')),
  });

  return (
    <Modal open onClose={onClose} title={t('tickets.actions.escalate')} maxWidth="sm">
      <div className="transfer-dept-modal">
        <div className="transfer-dept-warning">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7 4.2v3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="7" cy="9.6" r=".7" fill="currentColor" />
          </svg>
          <span>{t('tickets.escalate.warning')}</span>
        </div>

        <div className="transfer-dept-field">
          <label htmlFor="escalate-level">{t('tickets.escalate.targetLevel')} *</label>
          <select
            id="escalate-level"
            value={level}
            onChange={(event) => setLevel(event.target.value as TargetLevel)}
          >
            {options.map((option) => (
              <option key={option} value={option}>{levelLabel(option)}</option>
            ))}
          </select>
        </div>

        <div className="transfer-dept-actions">
          <button type="button" className="zd-btn zd-btn-secondary" onClick={onClose}>
            {t('tickets.actions.cancel')}
          </button>
          <button
            type="button"
            className="zd-btn zd-btn-primary"
            disabled={!level || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('tickets.escalate.confirm')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
