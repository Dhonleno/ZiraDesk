import type { AxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

const schema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  role: z.enum(['admin', 'supervisor', 'agent', 'viewer']),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface InviteErrorResponse {
  success: false;
  error?: {
    code?: string;
    message?: string;
  };
}

function mapInviteErrorMessage(rawMessage: string | undefined, t: (key: string) => string): string {
  const message = (rawMessage ?? '').toLowerCase();

  if (message.includes('resend_api_key') || message.includes('não configurado')) {
    return t('tenantAdmin.users.messages.inviteEmailNotConfigured');
  }

  if (message.includes('resend_from_email') || message.includes('domínio') || message.includes('domain')) {
    return t('tenantAdmin.users.messages.inviteEmailDomainNotVerified');
  }

  return t('tenantAdmin.users.messages.inviteError');
}

export function InviteUserModal({ open, onClose }: Props) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', role: 'agent' },
  });

  const mutation = useMutation({
    mutationFn: adminApi.inviteUser,
    onSuccess: () => {
      toast.success(t('tenantAdmin.users.messages.inviteSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      handleClose();
    },
    onError: (err: AxiosError<InviteErrorResponse>) => {
      const code = err.response?.data?.error?.code;
      const rawMessage = err.response?.data?.error?.message;

      if (code === 'EMAIL_NOT_CONFIGURED') {
        toast.error(t('tenantAdmin.users.messages.inviteEmailNotConfigured'));
        return;
      }

      if (code === 'EMAIL_SEND_FAILED') {
        toast.error(t('tenantAdmin.users.messages.inviteEmailDeliveryFailed'));
        return;
      }

      toast.error(mapInviteErrorMessage(rawMessage, t as (key: string) => string));
    },
  });

  function handleClose() {
    reset();
    onClose();
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-3)',
    border: '1px solid var(--line-2)',
    color: 'var(--txt)',
    height: '2.5rem',
    borderRadius: '0.5rem',
    padding: '0 0.75rem',
    fontSize: '0.875rem',
    width: '100%',
    outline: 'none',
  };

  return (
    <Modal open={open} onClose={handleClose} title={t('tenantAdmin.users.inviteUser')}>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        <Input
          label={t('tenantAdmin.users.fields.name')}
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label={t('tenantAdmin.users.fields.email')}
          type="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.fields.role')}
          </label>
          <select aria-label={t('tenantAdmin.users.fields.role')} style={selectStyle} {...register('role')}>
            <option value="admin">{t('tenantAdmin.users.roles.admin')}</option>
            <option value="supervisor">{t('tenantAdmin.users.roles.supervisor')}</option>
            <option value="agent">{t('tenantAdmin.users.roles.agent')}</option>
            <option value="viewer">{t('tenantAdmin.users.roles.viewer')}</option>
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={handleClose}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('tenantAdmin.common.inviting') : t('tenantAdmin.common.invite')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
