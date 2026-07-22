import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface TenantUser {
  id: string;
  name: string;
  email: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: TenantUser | null;
}

type ResetMethod = 'email' | 'provisional';

function getErrorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? fallback;
}

export function ResetPasswordModal({ open, onClose, user }: Props) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [method, setMethod] = useState<ResetMethod>('email');
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const handleClose = () => {
    setMethod('email');
    setTempPassword(null);
    onClose();
  };

  const emailMutation = useMutation({
    mutationFn: () => adminApi.resetUserPassword(user!.id),
    onSuccess: () => {
      toast.success(t('tenantAdmin.users.messages.resetLinkSent', { email: user?.email }));
      handleClose();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, t('tenantAdmin.common.errorSave')));
    },
  });

  const provisionalMutation = useMutation({
    mutationFn: () => adminApi.generateProvisionalPassword(user!.id),
    onSuccess: (data) => {
      setTempPassword(data.tempPassword);
      toast.success(t('tenantAdmin.users.resetPassword.provisionalSent', { name: user?.name }));
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, t('tenantAdmin.common.errorSave')));
    },
  });

  const isPending = emailMutation.isPending || provisionalMutation.isPending;

  const handleConfirm = () => {
    if (method === 'email') {
      emailMutation.mutate();
    } else {
      provisionalMutation.mutate();
    }
  };

  const handleCopy = () => {
    if (tempPassword) void navigator.clipboard.writeText(tempPassword);
  };

  return (
    <Modal open={open} onClose={handleClose} title={t('tenantAdmin.users.resetPassword.title')}>
      {tempPassword ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.resetPassword.provisionalCreated')}
          </p>
          <div className="provisional-password-box">
            <code>{tempPassword}</code>
            <button type="button" className="tb-icon-btn" onClick={handleCopy}>
              {t('tenantAdmin.common.copy')}
            </button>
          </div>
          <p className="provisional-password-warning">
            {t('tenantAdmin.users.resetPassword.provisionalWarning')}
          </p>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={handleClose}>
              {t('tenantAdmin.common.close')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.messages.resetPasswordConfirm', { name: user?.name, email: user?.email })}
          </p>

          <div style={{ display: 'grid', gap: 8 }}>
            <label className={`reset-method-option${method === 'email' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="reset-method"
                value="email"
                checked={method === 'email'}
                onChange={() => setMethod('email')}
              />
              <div>
                <div className="reset-method-title">{t('tenantAdmin.users.resetPassword.emailMethod')}</div>
                <div className="reset-method-desc">
                  {t('tenantAdmin.users.resetPassword.emailDesc', { email: user?.email })}
                </div>
              </div>
            </label>
            <label className={`reset-method-option${method === 'provisional' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="reset-method"
                value="provisional"
                checked={method === 'provisional'}
                onChange={() => setMethod('provisional')}
              />
              <div>
                <div className="reset-method-title">{t('tenantAdmin.users.resetPassword.provisionalMethod')}</div>
                <div className="reset-method-desc">{t('tenantAdmin.users.resetPassword.provisionalDesc')}</div>
              </div>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={handleClose}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              style={{ background: 'var(--teal)', borderColor: 'var(--teal)' }}
            >
              {isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
