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

  const mutation = useMutation({
    mutationFn: () => adminApi.resetUserPassword(user!.id),
    onSuccess: () => {
      toast.success(t('tenantAdmin.users.messages.resetLinkSent', { email: user?.email }));
      onClose();
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={t('tenantAdmin.users.resetPassword')}>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          {t('tenantAdmin.users.messages.resetPasswordConfirm', { name: user?.name, email: user?.email })}
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            style={{ background: 'var(--teal)', borderColor: 'var(--teal)' }}
          >
            {mutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.users.resetPassword')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
