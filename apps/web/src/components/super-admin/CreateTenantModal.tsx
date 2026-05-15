import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useToast } from '../../stores/toast.store';

type WizardStep = 0 | 1 | 2;

interface Plan {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

interface CreateTenantModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface CreateTenantResponse {
  success: boolean;
  data: {
    tenant: { id: string; name: string; slug: string };
    tempPassword: string;
  };
}

interface SlugAvailabilityResponse {
  success: boolean;
  data: {
    slug: string;
    available: boolean;
  };
}

interface CredentialsState {
  tenantName: string;
  ownerEmail: string;
  tempPassword: string;
}

function buildSlug(source: string): string {
  return source
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function CreateTenantModal({ open, onClose, onSuccess }: CreateTenantModalProps) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [credentials, setCredentials] = useState<CredentialsState | null>(null);

  const schema = useMemo(
    () => z.object({
      name: z.string().trim().min(1, t('superAdmin.tenants.createWizard.validation.nameRequired')).max(100),
      slug: z
        .string()
        .trim()
        .min(2, t('superAdmin.tenants.createWizard.validation.slugMin'))
        .max(50, t('superAdmin.tenants.createWizard.validation.slugMax'))
        .regex(/^[a-z0-9-]+$/, t('superAdmin.tenants.createWizard.validation.slugFormat')),
      planId: z.string().trim().min(1, t('superAdmin.tenants.createWizard.validation.planRequired')),
      trialDays: z.coerce
        .number()
        .int(t('superAdmin.tenants.createWizard.validation.trialDaysInt'))
        .min(1, t('superAdmin.tenants.createWizard.validation.trialDaysMin'))
        .max(365, t('superAdmin.tenants.createWizard.validation.trialDaysMax')),
      ownerName: z.string().trim().min(1, t('superAdmin.tenants.createWizard.validation.ownerNameRequired')).max(100),
      ownerEmail: z.string().trim().email(t('superAdmin.tenants.createWizard.validation.ownerEmailInvalid')),
    }),
    [t],
  );

  type FormData = z.infer<typeof schema>;
  const stepFields: Record<WizardStep, Array<keyof FormData>> = {
    0: ['name', 'slug'],
    1: ['planId', 'trialDays'],
    2: ['ownerName', 'ownerEmail'],
  };

  const {
    register,
    handleSubmit,
    reset,
    trigger,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      slug: '',
      planId: '',
      trialDays: 14,
      ownerName: '',
      ownerEmail: '',
    },
  });

  const nameValue = watch('name');
  const slugValue = watch('slug');
  const planIdValue = watch('planId');
  const trialDaysValue = watch('trialDays');
  const ownerNameValue = watch('ownerName');
  const ownerEmailValue = watch('ownerEmail');
  const debouncedSlug = useDebounce(slugValue, 450);

  const { data: plans = [] } = useQuery({
    queryKey: ['super-admin', 'plans'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Plan[] }>('/super-admin/plans');
      return res.data.data.filter((plan) => plan.isActive);
    },
    enabled: open,
  });

  const slugIsFormatValid = /^[a-z0-9-]{2,50}$/.test(debouncedSlug);
  const { data: slugCheck, isFetching: isCheckingSlug } = useQuery({
    queryKey: ['super-admin', 'tenants', 'check-slug', debouncedSlug],
    queryFn: async () => {
      const res = await api.get<SlugAvailabilityResponse>(
        `/super-admin/tenants/check-slug?slug=${encodeURIComponent(debouncedSlug)}`,
      );
      return res.data.data;
    },
    enabled: open && currentStep === 0 && slugIsFormatValid,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: FormData) => {
      const res = await api.post<CreateTenantResponse>('/super-admin/tenants', payload);
      return res.data.data;
    },
    onSuccess: (data) => {
      toast.success(t('superAdmin.tenants.messages.created'));
      setCredentials({
        tenantName: data.tenant.name,
        ownerEmail: ownerEmailValue,
        tempPassword: data.tempPassword,
      });
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        t('superAdmin.tenants.createWizard.messages.createError');
      toast.error(message);
    },
  });

  useEffect(() => {
    if (!open) {
      setCurrentStep(0);
      setSlugManuallyEdited(false);
      setCredentials(null);
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    if (slugManuallyEdited) return;
    const generatedSlug = buildSlug(nameValue ?? '');
    setValue('slug', generatedSlug, { shouldValidate: true, shouldDirty: true });
  }, [open, slugManuallyEdited, nameValue, setValue]);

  useEffect(() => {
    if (!open) return;
    if (planIdValue) return;
    const [firstPlan] = plans;
    if (!firstPlan) return;
    setValue('planId', firstPlan.id, { shouldValidate: true });
  }, [open, planIdValue, plans, setValue]);

  useEffect(() => {
    if (!slugValue) return;
    if (!slugIsFormatValid) return;
    if (slugCheck?.available) clearErrors('slug');
  }, [clearErrors, slugCheck?.available, slugIsFormatValid, slugValue]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === planIdValue) ?? null,
    [plans, planIdValue],
  );

  const slugStatus = useMemo(() => {
    if (!slugValue) return 'idle' as const;
    if (!/^[a-z0-9-]{2,50}$/.test(slugValue)) return 'invalid' as const;
    if (isCheckingSlug) return 'checking' as const;
    if (slugCheck?.available === false) return 'taken' as const;
    if (slugCheck?.available === true) return 'available' as const;
    return 'idle' as const;
  }, [isCheckingSlug, slugCheck?.available, slugValue]);

  const slugHintMap: Record<typeof slugStatus, string> = {
    idle: t('superAdmin.tenants.createWizard.slug.idleHint'),
    invalid: t('superAdmin.tenants.createWizard.slug.invalidHint'),
    checking: t('superAdmin.tenants.createWizard.slug.checkingHint'),
    taken: t('superAdmin.tenants.createWizard.slug.takenHint'),
    available: t('superAdmin.tenants.createWizard.slug.availableHint'),
  };

  const closeFormModal = () => {
    if (createMutation.isPending) return;
    onClose();
  };

  const closeCredentialsModal = () => {
    setCredentials(null);
    reset();
    setCurrentStep(0);
    setSlugManuallyEdited(false);
    onSuccess();
  };

  const goToNextStep = async () => {
    const isCurrentStepValid = await trigger(stepFields[currentStep], { shouldFocus: true });
    if (!isCurrentStepValid) return;

    if (currentStep === 0) {
      if (slugStatus === 'checking') return;
      const currentSlug = slugValue.trim();
      let isSlugAvailable = slugStatus === 'available';

      if (!isSlugAvailable && /^[a-z0-9-]{2,50}$/.test(currentSlug)) {
        try {
          const res = await api.get<SlugAvailabilityResponse>(
            `/super-admin/tenants/check-slug?slug=${encodeURIComponent(currentSlug)}`,
          );
          isSlugAvailable = res.data.data.available;
        } catch {
          isSlugAvailable = false;
        }
      }

      if (!isSlugAvailable) {
        setError('slug', { type: 'manual', message: t('superAdmin.tenants.createWizard.validation.slugTaken') });
        return;
      }
    }

    if (currentStep < 2) setCurrentStep((currentStep + 1) as WizardStep);
  };

  const goToPreviousStep = () => {
    if (currentStep > 0) setCurrentStep((currentStep - 1) as WizardStep);
  };

  const steps = [
    t('superAdmin.tenants.createWizard.steps.company'),
    t('superAdmin.tenants.createWizard.steps.plan'),
    t('superAdmin.tenants.createWizard.steps.owner'),
  ];

  const submitForm = handleSubmit(async (values) => {
    if (slugStatus === 'taken' || slugStatus === 'invalid' || slugStatus === 'checking') {
      setError('slug', { type: 'manual', message: t('superAdmin.tenants.createWizard.validation.slugTaken') });
      setCurrentStep(0);
      return;
    }

    await createMutation.mutateAsync(values);
  });

  return (
    <>
      <Modal
        open={open && credentials === null}
        onClose={closeFormModal}
        title={t('superAdmin.tenants.new')}
        maxWidth="md"
        maxWidthPx={480}
      >
        <div className="sa-wizard-steps" role="list" aria-label={t('superAdmin.tenants.createWizard.stepsAriaLabel')}>
          {steps.map((label, index) => {
            const step = index as WizardStep;
            const state = currentStep === step ? 'active' : currentStep > step ? 'done' : 'idle';
            return (
              <div key={label} className={`sa-wizard-step sa-wizard-step-${state}`} role="listitem">
                <span className="sa-wizard-step-index">{step + 1}</span>
                <span className="sa-wizard-step-label">{label}</span>
              </div>
            );
          })}
        </div>

        <form onSubmit={submitForm} className="sa-modal-grid">
          {currentStep === 0 && (
            <>
              <Input
                label={t('superAdmin.tenants.fields.name')}
                placeholder={t('superAdmin.tenants.createWizard.placeholders.name')}
                error={errors.name?.message}
                {...register('name')}
              />

              <Input
                label={t('superAdmin.tenants.fields.slug')}
                placeholder={t('superAdmin.tenants.createWizard.placeholders.slug')}
                error={errors.slug?.message}
                hint={slugHintMap[slugStatus]}
                {...register('slug', { onChange: () => setSlugManuallyEdited(true) })}
              />
            </>
          )}

          {currentStep === 1 && (
            <>
              <div className="sa-modal-grid">
                <label className="sa-modal-label" htmlFor="create-tenant-plan-id">
                  {t('superAdmin.tenants.fields.plan')}
                </label>
                <select
                  id="create-tenant-plan-id"
                  className="sa-select"
                  {...register('planId')}
                >
                  <option value="">{t('superAdmin.tenants.createWizard.placeholders.plan')}</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
                {errors.planId && (
                  <p className="text-xs" style={{ color: 'var(--red)' }}>
                    {errors.planId.message}
                  </p>
                )}
              </div>

              <Input
                type="number"
                min={1}
                max={365}
                label={t('superAdmin.tenants.fields.trialDays')}
                placeholder={t('superAdmin.tenants.createWizard.placeholders.trialDays')}
                error={errors.trialDays?.message}
                {...register('trialDays')}
              />

              {selectedPlan && (
                <p className="sa-wizard-note">
                  {t('superAdmin.tenants.createWizard.planSelected', { plan: selectedPlan.name })}
                </p>
              )}
            </>
          )}

          {currentStep === 2 && (
            <>
              <Input
                label={t('superAdmin.tenants.fields.owner')}
                placeholder={t('superAdmin.tenants.createWizard.placeholders.owner')}
                error={errors.ownerName?.message}
                {...register('ownerName')}
              />

              <Input
                type="email"
                label={t('superAdmin.tenants.fields.ownerEmail')}
                placeholder={t('superAdmin.tenants.createWizard.placeholders.ownerEmail')}
                error={errors.ownerEmail?.message}
                {...register('ownerEmail')}
              />

              <div className="sa-wizard-review">
                <p className="sa-wizard-review-title">{t('superAdmin.tenants.createWizard.review.title')}</p>
                <div className="sa-wizard-review-row">
                  <span>{t('superAdmin.tenants.fields.name')}</span>
                  <strong>{nameValue || '—'}</strong>
                </div>
                <div className="sa-wizard-review-row">
                  <span>{t('superAdmin.tenants.fields.slug')}</span>
                  <strong>{slugValue || '—'}</strong>
                </div>
                <div className="sa-wizard-review-row">
                  <span>{t('superAdmin.tenants.fields.plan')}</span>
                  <strong>{selectedPlan?.name ?? '—'}</strong>
                </div>
                <div className="sa-wizard-review-row">
                  <span>{t('superAdmin.tenants.fields.trialDays')}</span>
                  <strong>{trialDaysValue ?? '—'}</strong>
                </div>
                <div className="sa-wizard-review-row">
                  <span>{t('superAdmin.tenants.fields.owner')}</span>
                  <strong>{ownerNameValue || '—'}</strong>
                </div>
                <div className="sa-wizard-review-row">
                  <span>{t('superAdmin.tenants.fields.ownerEmail')}</span>
                  <strong>{ownerEmailValue || '—'}</strong>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-3">
            {currentStep > 0 && (
              <Button type="button" variant="secondary" onClick={goToPreviousStep} disabled={createMutation.isPending}>
                {t('superAdmin.tenants.createWizard.actions.back')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={closeFormModal}
              disabled={createMutation.isPending}
            >
              {t('tenantAdmin.common.cancel')}
            </Button>
            {currentStep < 2 ? (
              <Button
                type="button"
                onClick={() => void goToNextStep()}
                disabled={currentStep === 0 && slugStatus === 'checking'}
              >
                {t('superAdmin.tenants.createWizard.actions.next')}
              </Button>
            ) : (
              <Button type="submit" loading={createMutation.isPending}>
                {t('superAdmin.tenants.createWizard.actions.create')}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={credentials !== null}
        onClose={closeCredentialsModal}
        title={t('superAdmin.tenants.credentialsModal.title')}
        maxWidth="md"
      >
        {credentials && (
          <div className="sa-modal-grid">
            <p className="m-0 text-sm" style={{ color: 'var(--txt-2)', lineHeight: 1.6 }}>
              {t('superAdmin.tenants.credentialsModal.description', { tenant: credentials.tenantName })}
            </p>
            <div className="sa-wizard-review">
              <div className="sa-wizard-review-row">
                <span>{t('superAdmin.tenants.credentialsModal.ownerEmail')}</span>
                <strong>{credentials.ownerEmail}</strong>
              </div>
              <div className="sa-wizard-review-row">
                <span>{t('superAdmin.tenants.credentialsModal.tempPassword')}</span>
                <strong>{credentials.tempPassword}</strong>
              </div>
            </div>
            <p className="m-0 text-xs" style={{ color: 'var(--txt-3)' }}>
              {t('superAdmin.tenants.credentialsModal.note')}
            </p>
            <div className="flex justify-end pt-2">
              <Button type="button" onClick={closeCredentialsModal}>
                {t('tenantAdmin.common.close')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
