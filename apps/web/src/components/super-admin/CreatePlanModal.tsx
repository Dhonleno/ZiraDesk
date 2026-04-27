import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useToast } from '../../stores/toast.store';

const AVAILABLE_FEATURES = [
  'whatsapp',
  'email',
  'live_chat',
  'reports',
  'api_access',
  'custom_domain',
  'sla',
  'webhooks',
] as const;

const schema = z.object({
  name: z.string().min(1).max(50),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Apenas letras minúsculas, números e hífens'),
  priceMonth: z.coerce.number().positive(),
  priceYear: z.coerce.number().positive().optional(),
  maxUsers: z.coerce.number().int(),
  maxContacts: z.coerce.number().int(),
  features: z.record(z.boolean()).default({}),
  isActive: z.boolean().default(true),
});

type FormData = z.infer<typeof schema>;

interface CreatePlanModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreatePlanModal({ open, onClose, onSuccess }: CreatePlanModalProps) {
  const { t } = useTranslation('admin');
  const toast = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      maxUsers: -1,
      maxContacts: -1,
      isActive: true,
      features: {},
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        features: Object.fromEntries(
          AVAILABLE_FEATURES.map((f) => [f, data.features[f] ?? false]),
        ),
      };
      return api.post('/super-admin/plans', payload);
    },
    onSuccess: () => {
      toast.success(t('superAdmin.plans.messages.created'));
      reset();
      onSuccess();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        'Erro ao criar plano';
      toast.error(message);
    },
  });

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('superAdmin.plans.new')}>
      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Nome"
            placeholder="Pro"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Slug"
            placeholder="pro"
            error={errors.slug?.message}
            {...register('slug')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Preço/mês (R$)"
            type="number"
            step="0.01"
            placeholder="197.00"
            error={errors.priceMonth?.message}
            {...register('priceMonth')}
          />
          <Input
            label="Preço/ano (R$)"
            type="number"
            step="0.01"
            placeholder="1970.00"
            error={errors.priceYear?.message}
            {...register('priceYear')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Máx. usuários (-1 = ilimitado)"
            type="number"
            error={errors.maxUsers?.message}
            {...register('maxUsers')}
          />
          <Input
            label="Máx. contatos (-1 = ilimitado)"
            type="number"
            error={errors.maxContacts?.message}
            {...register('maxContacts')}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">Recursos</label>
          <div className="grid grid-cols-2 gap-2">
            {AVAILABLE_FEATURES.map((feature) => (
              <label key={feature} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  {...register(`features.${feature}`)}
                  className="h-4 w-4 rounded border-line-2 bg-bg-4 text-teal focus:ring-teal"
                />
                <span className="text-sm text-gray-300">{feature}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            {...register('isActive')}
            className="h-4 w-4 rounded border-line-2 bg-bg-4 text-teal focus:ring-teal"
          />
          <span className="text-sm text-gray-300">Plano ativo</span>
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Criar plano
          </Button>
        </div>
      </form>
    </Modal>
  );
}
