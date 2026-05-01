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

export function ResetPasswordModal({ open, onClose, user }: Props) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => adminApi.resetUserPassword(user!.id),
    onSuccess: (res) => {
      setTempPassword(res.data.tempPassword);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  function handleClose() {
    setTempPassword(null);
    setCopied(false);
    onClose();
  }

  async function handleCopy() {
    if (tempPassword) {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('tenantAdmin.users.resetPassword')}>
      {tempPassword ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.messages.passwordReset', { name: user?.name })}
          </p>
          <div
            className="flex items-center gap-3 rounded-lg p-4"
            style={{ background: 'rgba(0,201,167,.08)', border: '1px solid rgba(0,201,167,.25)' }}
          >
            <span className="flex-1 font-mono text-lg font-semibold" style={{ color: 'var(--teal)' }}>
              {tempPassword}
            </span>
            <button
              onClick={handleCopy}
              className="rounded-lg px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: copied ? 'rgba(0,201,167,.2)' : 'rgba(255,255,255,.05)',
                color: copied ? 'var(--teal)' : 'var(--txt-2)',
                border: '1px solid var(--line)',
              }}
            >
              {copied ? '✓' : 'Copiar'}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {t('tenantAdmin.users.messages.tempPasswordHint')}
          </p>
          <div className="flex justify-end pt-2">
            <Button onClick={handleClose}>{t('tenantAdmin.common.close')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.messages.resetPasswordConfirm', { name: user?.name, email: user?.email })}
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={handleClose}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
            >
              {mutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.users.resetPassword')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
