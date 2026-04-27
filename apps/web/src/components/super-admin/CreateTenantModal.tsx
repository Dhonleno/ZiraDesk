import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useToast } from '../../stores/toast.store';

const schema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Apenas letras minúsculas, números e hífens'),
  planId: z.string().min(1, 'Selecione um plano'),
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  trialDays: z.coerce.number().int().min(0).max(365).default(14),
});

type FormData = z.infer<typeof schema>;

interface Plan {
  id: string;
  name: string;
  slug: string;
  priceMonth: string;
  isActive: boolean;
}

interface CreateTenantModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateTenantModal({ open, onClose, onSuccess }: CreateTenantModalProps) {
  const { t } = useTranslation('admin');
  const toast = useToast();

  const { data: plans = [] } = useQuery({
    queryKey: ['super-admin', 'plans'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Plan[] }>('/super-admin/plans');
      return res.data.data.filter((p) => p.isActive);
    },
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { trialDays: 14 },
  });

  const nameValue = watch('name');

  useEffect(() => {
    if (nameValue) {
      const slug = nameValue
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setValue('slug', slug, { shouldValidate: false });
    }
  }, [nameValue, setValue]);

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await api.post<{ success: boolean; data: { tenant: { name: string }; tempPassword: string } }>(
        '/super-admin/tenants',
        data,
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      toast.success(t('superAdmin.tenants.messages.created'));
      alert(
        `Tenant criado!\n\nE-mail: ${watch('ownerEmail')}\nSenha temporária: ${data.tempPassword}\n\nAnote antes de fechar.`,
      );
      reset();
      onSuccess();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        'Erro ao criar tenant';
      toast.error(message);
    },
  });

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('superAdmin.tenants.new')}>
      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
        <Input
          label="Nome da empresa"
          placeholder="Acme Corp"
          error={errors.name?.message}
          {...register('name')}
        />

        <Input
          label="Subdomínio"
          placeholder="acme-corp"
          error={errors.slug?.message}
          {...register('slug')}
        />

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-300">Plano</label>
          <select
            {...register('planId')}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Selecione um plano</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          {errors.planId && <p className="text-xs text-red-400">{errors.planId.message}</p>}
        </div>

        <Input
          label="Nome do responsável"
          placeholder="João Silva"
          error={errors.ownerName?.message}
          {...register('ownerName')}
        />

        <Input
          label="E-mail do responsável"
          type="email"
          placeholder="joao@acme.com"
          error={errors.ownerEmail?.message}
          {...register('ownerEmail')}
        />

        <Input
          label="Dias de trial"
          type="number"
          error={errors.trialDays?.message}
          {...register('trialDays')}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Criar tenant
          </Button>
        </div>
      </form>
    </Modal>
  );
}
