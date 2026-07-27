import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, ticketsApi, type Ticket } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { Modal } from '../ui/Modal';

interface Props {
  ticket: Ticket;
  onClose: () => void;
  onSuccess: (updated: Ticket) => void;
}

export function TransferDepartmentModal({ ticket, onClose, onSuccess }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();
  const [departmentId, setDepartmentId] = useState('');
  const [reason, setReason] = useState('');

  const { data: departments = [] } = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: adminApi.departments.list,
    staleTime: 5 * 60_000,
  });

  // O backend rejeita transferir para o mesmo departamento e só aceita ativos.
  const availableDepartments = departments.filter(
    (department) => department.id !== ticket.department_id && department.isActive,
  );

  const mutation = useMutation({
    mutationFn: () => ticketsApi.transferDepartment(ticket.id, {
      department_id: departmentId,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }),
    onSuccess: (updated) => {
      toast.success(t('tickets.actions.transferSuccess'));
      onSuccess(updated);
      onClose();
    },
    onError: () => toast.error(t('tickets.actions.transferError')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t('tickets.actions.transferDepartment')}
      maxWidth="sm"
    >
      <div className="transfer-dept-modal">
        <div className="transfer-dept-warning">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7 4.2v3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="7" cy="9.6" r=".7" fill="currentColor" />
          </svg>
          <span>{t('tickets.transfer.warning')}</span>
        </div>

        <div className="transfer-dept-field">
          <label htmlFor="transfer-dept-target">{t('tickets.transfer.targetDept')} *</label>
          <select
            id="transfer-dept-target"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">{t('tickets.transfer.selectDept')}</option>
            {availableDepartments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        </div>

        <div className="transfer-dept-field">
          <label htmlFor="transfer-dept-reason">
            {t('tickets.transfer.reason')} ({t('optional', { ns: 'common' })})
          </label>
          <textarea
            id="transfer-dept-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t('tickets.transfer.reasonPlaceholder')}
          />
        </div>

        <div className="transfer-dept-actions">
          <button type="button" className="zd-btn zd-btn-secondary" onClick={onClose}>
            {t('tickets.actions.cancel')}
          </button>
          <button
            type="button"
            className="zd-btn zd-btn-primary"
            disabled={!departmentId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('tickets.transfer.confirm')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
