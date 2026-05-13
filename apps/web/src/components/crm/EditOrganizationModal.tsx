import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { PhoneInput } from '../ui/PhoneInput';
import type { CrmOrganization } from '../../services/api';
import { organizationsApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { isValidOptionalPhone } from '../../lib/phone';

const buildSchema = (invalidPhoneMessage: string) => z.object({
  name:           z.string().min(2),
  type:           z.enum(['company', 'person']),
  document:       z.string().optional(),
  email:          z.union([z.string().email(), z.literal('')]).optional(),
  phone:          z.string().optional().refine(isValidOptionalPhone, { message: invalidPhoneMessage }),
  website:        z.string().optional(),
  status:         z.enum(['lead', 'prospect', 'client', 'inactive']),
  address_street: z.string().optional(),
  address_city:   z.string().optional(),
  address_state:  z.string().optional(),
  address_zip:    z.string().optional(),
  segment:        z.string().optional(),
  lead_source:    z.string().optional(),
});

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  org: CrmOrganization | null;
  onClose: () => void;
}

export function EditOrganizationModal({ org, onClose }: Props) {
  const { t } = useTranslation(['crm', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const schema = useMemo(() => buildSchema(t('phone.invalid', { ns: 'common' })), [t]);

  const { register, handleSubmit, watch, setValue, setError, clearErrors, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'company', status: 'lead' },
  });
  const phoneValue = watch('phone') ?? '';

  useEffect(() => {
    if (!org) return;
    reset({
      name:           org.name,
      type:           org.type,
      document:       org.document ?? '',
      email:          org.email ?? '',
      phone:          org.phone ?? '',
      website:        org.website ?? '',
      status:         org.status,
      address_street: org.address_street ?? '',
      address_city:   org.address_city ?? '',
      address_state:  org.address_state ?? '',
      address_zip:    org.address_zip ?? '',
      segment:        org.segment ?? '',
      lead_source:    org.lead_source ?? '',
    });
  }, [org, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => organizationsApi.update(org!.id, {
      name:           values.name,
      type:           values.type,
      status:         values.status,
      document:       values.document || null,
      email:          values.email || null,
      phone:          values.phone || null,
      website:        values.website || null,
      address_street: values.address_street || null,
      address_city:   values.address_city || null,
      address_state:  values.address_state || null,
      address_zip:    values.address_zip || null,
      segment:        values.segment || null,
      lead_source:    values.lead_source || null,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-organization', org?.id] });
      toast.success(t('organizations.modal.successUpdated'));
      onClose();
    },
    onError: () => {
      toast.error('Erro ao atualizar organização');
    },
  });

  const statusOptions: { value: FormValues['status']; label: string }[] = [
    { value: 'lead',     label: t('organizations.status.lead') },
    { value: 'prospect', label: t('organizations.status.prospect') },
    { value: 'client',   label: t('organizations.status.client') },
    { value: 'inactive', label: t('organizations.status.inactive') },
  ];

  const sourceOptions = [
    { value: 'site',          label: t('organizations.modal.sources.site') },
    { value: 'indicacao',     label: t('organizations.modal.sources.indicacao') },
    { value: 'redes_sociais', label: t('organizations.modal.sources.redes_sociais') },
    { value: 'whatsapp',      label: t('organizations.modal.sources.whatsapp') },
    { value: 'outro',         label: t('organizations.modal.sources.outro') },
  ];

  const selectStyle = { height: '2.5rem', borderRadius: '0.5rem', padding: '0 0.75rem', fontSize: '0.875rem', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)', width: '100%' } as const;

  return (
    <Modal open={!!org} onClose={onClose} title={t('organizations.modal.editTitle')} maxWidth="md">
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))}>
        <div className="space-y-4">
          <Input label={t('organizations.fields.name')} error={errors.name?.message} autoFocus {...register('name')} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('organizations.fields.type')}</label>
              <select {...register('type')} style={selectStyle}>
                <option value="company">{t('organizations.type.company')}</option>
                <option value="person">{t('organizations.type.person')}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('organizations.fields.status')}</label>
              <select {...register('status')} style={selectStyle}>
                {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <Input label={t('organizations.fields.document')} {...register('document')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('organizations.fields.email')} type="email" error={errors.email?.message} {...register('email')} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('organizations.fields.phone')}</label>
              <PhoneInput
                country="BR"
                value={phoneValue}
                onChange={(nextValue, isValid) => {
                  setValue('phone', nextValue, { shouldDirty: true });
                  if (!nextValue || isValid) {
                    clearErrors('phone');
                    return;
                  }
                  setError('phone', { type: 'manual', message: t('phone.invalid', { ns: 'common' }) });
                }}
                placeholder="11 3333-4444"
                error={errors.phone?.message}
              />
            </div>
          </div>
          <Input label={t('organizations.fields.website')} {...register('website')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('organizations.fields.zip')} {...register('address_zip')} />
            <Input label={t('organizations.fields.state')} {...register('address_state')} />
          </div>
          <Input label={t('organizations.fields.street')} {...register('address_street')} />
          <Input label={t('organizations.fields.city')} {...register('address_city')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('organizations.fields.segment')} {...register('segment')} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('organizations.fields.leadSource')}</label>
              <select {...register('lead_source')} style={selectStyle}>
                <option value="">— {t('organizations.fields.notInformed')}</option>
                {sourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('organizations.modal.submittingEdit') : t('organizations.modal.submitEdit')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
