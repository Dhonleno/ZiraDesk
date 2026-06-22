import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PLAN_FEATURES } from '@ziradesk/shared';
import { superAdminApi } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useToast } from '../../stores/toast.store';

interface Plan {
  id: string;
  name: string;
  slug: string;
  priceMonth: string;
  priceYear: string;
  maxUsers: number;
  maxContacts: number;
  maxMessages: number;
  features: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

const schema = z.object({
  name: z.string().min(1).max(50),
  priceMonth: z.coerce.number().positive(),
  priceYear: z.coerce.number().positive().optional(),
  maxUsers: z.coerce.number().int(),
  maxContacts: z.coerce.number().int(),
  maxMessages: z.coerce.number().int(),
  features: z.record(z.boolean()).default({}),
});

type FormData = z.infer<typeof schema>;

interface EditPlanModalProps {
  plan: Plan;
  onClose: () => void;
  onSaved: () => void;
}

export function EditPlanModal({ plan, onClose, onSaved }: EditPlanModalProps) {
  const { t } = useTranslation('admin');
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: plan.name,
      priceMonth: Number(plan.priceMonth),
      priceYear: Number(plan.priceYear),
      maxUsers: plan.maxUsers,
      maxContacts: plan.maxContacts,
      maxMessages: plan.maxMessages,
      features: Object.fromEntries(
        PLAN_FEATURES.map((f) => [f, plan.features[f] === true]),
      ),
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const featuresPayload = PLAN_FEATURES.reduce(
        (acc, key) => {
          acc[key] = data.features[key] ?? false;
          return acc;
        },
        {} as Record<string, boolean>,
      );

      await superAdminApi.updatePlan(plan.id, {
        name: data.name,
        priceMonth: data.priceMonth,
        ...(data.priceYear !== undefined ? { priceYear: data.priceYear } : {}),
        maxUsers: data.maxUsers,
        maxContacts: data.maxContacts,
        maxMessages: data.maxMessages,
        features: featuresPayload,
      });
    },
    onSuccess: () => {
      toast.success(t('superAdmin.plans.messages.updated'));
      onSaved();
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        'Erro ao atualizar plano';
      toast.error(message);
    },
  });

  return (
    <Modal open={true} onClose={onClose} title={t('superAdmin.plans.editPlan')} maxWidth="md" maxWidthPx={480}>
      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
        <Input
          label={t('superAdmin.plans.fields.name')}
          error={errors.name?.message}
          {...register('name')}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label={t('superAdmin.plans.fields.priceMonth')}
            type="number"
            step="0.01"
            error={errors.priceMonth?.message}
            {...register('priceMonth')}
          />
          <Input
            label={t('superAdmin.plans.fields.priceYear')}
            type="number"
            step="0.01"
            error={errors.priceYear?.message}
            {...register('priceYear')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label={t('superAdmin.plans.fields.maxUsers')}
            type="number"
            error={errors.maxUsers?.message}
            {...register('maxUsers')}
          />
          <Input
            label={t('superAdmin.plans.fields.maxContacts')}
            type="number"
            error={errors.maxContacts?.message}
            {...register('maxContacts')}
          />
        </div>

        <Input
          label={t('superAdmin.plans.fields.maxMessages')}
          type="number"
          error={errors.maxMessages?.message}
          {...register('maxMessages')}
        />

        <div className="space-y-2">
          <label className="block text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
            {t('superAdmin.plans.fields.features')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PLAN_FEATURES.map((feature) => (
              <label key={feature} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  {...register(`features.${feature}`)}
                  className="h-4 w-4 rounded border-line-2 bg-bg-4 text-teal focus:ring-teal"
                />
                <span className="text-sm" style={{ color: 'var(--txt-2)' }}>{feature}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {t('tenantAdmin.common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
