import { useEffect } from 'react';
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
  role: z.enum(['admin', 'agent', 'viewer']),
});

type FormValues = z.infer<typeof schema>;

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: TenantUser | null;
}

export function EditUserModal({ open, onClose, user }: Props) {
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
    defaultValues: { name: '', role: 'agent' },
  });

  useEffect(() => {
    if (user) {
      reset({
        name: user.name,
        role: (user.role as FormValues['role']) ?? 'agent',
      });
    }
  }, [user, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => adminApi.updateUser(user!.id, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(t('tenantAdmin.users.messages.updated'));
      onClose();
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-3)',
    border: '1px solid var(--line)',
    color: 'var(--txt)',
    height: '2.5rem',
    borderRadius: '0.5rem',
    padding: '0 0.75rem',
    fontSize: '0.875rem',
    width: '100%',
    outline: 'none',
  };

  return (
    <Modal open={open} onClose={onClose} title={t('tenantAdmin.users.editUser')}>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        <Input
          label={t('tenantAdmin.users.fields.name')}
          error={errors.name?.message}
          {...register('name')}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.fields.email')}
          </label>
          <div
            className="h-10 rounded-lg px-3 flex items-center text-sm"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--txt-3)' }}
          >
            {user?.email}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.fields.role')}
          </label>
          <select style={selectStyle} {...register('role')}>
            <option value="admin">{t('tenantAdmin.users.roles.admin')}</option>
            <option value="agent">{t('tenantAdmin.users.roles.agent')}</option>
            <option value="viewer">{t('tenantAdmin.users.roles.viewer')}</option>
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
