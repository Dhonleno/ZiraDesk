import { useState } from 'react';
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

interface TempPasswordModalState {
  open: boolean;
  name: string;
  email: string;
  password: string;
}

function mapInviteErrorMessage(rawMessage: string | undefined, t: (key: string) => string): string {
  const message = (rawMessage ?? '').toLowerCase();

  if (message.includes('resend_api_key')) {
    return t('tenantAdmin.users.messages.inviteEmailNotConfigured');
  }

  if (message.includes('resend_from_email') || message.includes('domínio') || message.includes('domain')) {
    return t('tenantAdmin.users.messages.inviteEmailDomainNotVerified');
  }

  if (message.includes('não foi possível enviar o convite por e-mail') || message.includes('could not send invite email')) {
    return t('tenantAdmin.users.messages.inviteEmailDeliveryFailed');
  }

  return t('tenantAdmin.users.messages.inviteError');
}

export function InviteUserModal({ open, onClose }: Props) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tempPasswordModal, setTempPasswordModal] = useState<TempPasswordModalState | null>(null);
  const [copied, setCopied] = useState(false);

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
    onSuccess: (res) => {
      const inviteResult = res.data;
      if (!inviteResult.emailSent && inviteResult.tempPassword) {
        setTempPasswordModal({
          open: true,
          name: inviteResult.user.name,
          email: inviteResult.user.email,
          password: inviteResult.tempPassword,
        });
        return;
      }

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
    setTempPasswordModal(null);
    setCopied(false);
    reset();
    onClose();
  }

  async function handleCopy() {
    if (tempPasswordModal?.password) {
      await navigator.clipboard.writeText(tempPasswordModal.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
    <Modal
      open={open}
      onClose={handleClose}
      title={
        tempPasswordModal?.open
          ? t('tenantAdmin.users.messages.tempPasswordTitle')
          : t('tenantAdmin.users.inviteUser')
      }
    >
      {tempPasswordModal?.open ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.messages.tempPasswordDesc', { name: tempPasswordModal.name })}
          </p>
          <div
            className="rounded-lg p-3 text-xs"
            style={{ background: 'var(--amber-dim)', border: '1px solid var(--amber)', color: 'var(--amber)' }}
          >
            {t('tenantAdmin.users.messages.emailNotConfiguredWarning')}
          </div>
          <div
            className="flex items-center gap-3 rounded-lg p-4"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)' }}
          >
            <span className="flex-1 font-mono text-lg font-semibold" style={{ color: 'var(--txt)' }}>
              {tempPasswordModal.password}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: copied ? 'var(--teal-dim)' : 'var(--bg-4)',
                color: copied ? 'var(--teal)' : 'var(--txt-2)',
                border: '1px solid var(--line-2)',
              }}
            >
              {t('tenantAdmin.common.copy')}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {t('tenantAdmin.users.messages.tempPasswordHint')}
          </p>
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => {
                setTempPasswordModal(null);
                setCopied(false);
                reset();
                void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
                onClose();
              }}
            >
              {t('tenantAdmin.common.close')}
            </Button>
          </div>
        </div>
      ) : (
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
      )}
    </Modal>
  );
}
