import { useState } from 'react';
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
  role: z.enum(['admin', 'agent', 'viewer']),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InviteUserModal({ open, onClose }: Props) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
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
      setTempPassword(res.data.tempPassword);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(t('tenantAdmin.users.messages.invited'));
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  function handleClose() {
    setTempPassword(null);
    setCopied(false);
    reset();
    onClose();
  }

  async function handleCopy() {
    if (tempPassword) {
      await navigator.clipboard.writeText(tempPassword);
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
    <Modal open={open} onClose={handleClose} title={t('tenantAdmin.users.inviteUser')}>
      {tempPassword ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.messages.invited')}. {t('tenantAdmin.users.messages.tempPassword')}:
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
                border: '1px solid var(--line-2)',
              }}
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={handleClose}>{t('tenantAdmin.common.close')}</Button>
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
