import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { organizationsApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

const schema = z.object({
  name:        z.string().min(2, 'Mínimo 2 caracteres'),
  type:        z.enum(['company', 'person']),
  document:    z.string().optional(),
  email:       z.union([z.string().email('E-mail inválido'), z.literal('')]).optional(),
  phone:       z.string().optional(),
  status:      z.enum(['lead', 'prospect', 'client', 'inactive']),
  address_zip: z.string().optional(),
  address_street: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  segment:     z.string().optional(),
  lead_source: z.string().optional(),
  responsible_id: z.string().optional(),
  website:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateOrganizationModal({ open, onClose }: Props) {
  const { t } = useTranslation('crm');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipError, setZipError] = useState('');

  const { register, handleSubmit, setValue, reset, formState: { errors }, trigger } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'company', status: 'lead' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => organizationsApi.create({
      name:        values.name,
      type:        values.type,
      status:      values.status,
      ...(values.document    ? { document:       values.document }    : {}),
      ...(values.email       ? { email:          values.email }       : {}),
      ...(values.phone       ? { phone:          values.phone }       : {}),
      ...(values.website     ? { website:        values.website }     : {}),
      ...(values.address_zip ? { address_zip:    values.address_zip } : {}),
      ...(values.address_street ? { address_street: values.address_street } : {}),
      ...(values.address_city   ? { address_city:   values.address_city }   : {}),
      ...(values.address_state  ? { address_state:  values.address_state }  : {}),
      ...(values.segment     ? { segment:        values.segment }     : {}),
      ...(values.lead_source ? { lead_source:    values.lead_source } : {}),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-organizations'] });
      toast.success(t('organizations.modal.successCreated'));
      handleClose();
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? 'Erro ao criar organização');
    },
  });

  function handleClose() {
    reset();
    setStep(1);
    setZipError('');
    onClose();
  }

  async function lookupZip(zip: string) {
    const clean = zip.replace(/\D/g, '');
    if (clean.length !== 8) return;
    setZipLoading(true);
    setZipError('');
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json() as { erro?: boolean; logradouro?: string; localidade?: string; uf?: string };
      if (data.erro) { setZipError(t('organizations.modal.zipError')); return; }
      if (data.logradouro) setValue('address_street', data.logradouro);
      if (data.localidade) setValue('address_city', data.localidade);
      if (data.uf) setValue('address_state', data.uf);
    } catch {
      setZipError(t('organizations.modal.zipError'));
    } finally {
      setZipLoading(false);
    }
  }

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

  const title = `${t('organizations.modal.newTitle')} — ${step === 1 ? t('organizations.modal.step1') : t('organizations.modal.step2')}`;

  return (
    <Modal open={open} onClose={handleClose} title={title} maxWidth="md">
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))}>
        {step === 1 && (
          <div className="space-y-4">
            <Input
              label={t('organizations.fields.name')}
              error={errors.name?.message}
              autoFocus
              {...register('name')}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('organizations.fields.type')}</label>
                <select
                  {...register('type')}
                  style={{ height: '2.5rem', borderRadius: '0.5rem', padding: '0 0.75rem', fontSize: '0.875rem', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)', width: '100%' }}
                >
                  <option value="company">{t('organizations.type.company')}</option>
                  <option value="person">{t('organizations.type.person')}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('organizations.fields.status')}</label>
                <select
                  {...register('status')}
                  style={{ height: '2.5rem', borderRadius: '0.5rem', padding: '0 0.75rem', fontSize: '0.875rem', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)', width: '100%' }}
                >
                  {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <Input label={t('organizations.fields.document')} {...register('document')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('organizations.fields.email')} type="email" error={errors.email?.message} {...register('email')} />
              <Input label={t('organizations.fields.phone')} type="tel" {...register('phone')} />
            </div>
            <Input label={t('organizations.fields.website')} type="url" placeholder="https://..." {...register('website')} />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={async () => {
                  const ok = await trigger(['name', 'type', 'status', 'email']);
                  if (ok) setStep(2);
                }}
                style={{ padding: '6px 16px', borderRadius: 'var(--r)', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
              >
                {t('organizations.modal.next')}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Input
                  label={`${t('organizations.fields.zip')}${zipLoading ? ` — ${t('organizations.modal.zipLoading')}` : ''}`}
                  {...register('address_zip', {
                    onBlur: (e: React.FocusEvent<HTMLInputElement>) => lookupZip(e.target.value),
                  })}
                />
                {zipError && <span style={{ fontSize: 11, color: 'var(--red)' }}>{zipError}</span>}
              </div>
              <Input label={t('organizations.fields.state')} {...register('address_state')} />
            </div>
            <Input label={t('organizations.fields.street')} {...register('address_street')} />
            <Input label={t('organizations.fields.city')} {...register('address_city')} />
            <Input label={t('organizations.fields.segment')} {...register('segment')} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('organizations.fields.leadSource')}</label>
              <select
                {...register('lead_source')}
                style={{ height: '2.5rem', borderRadius: '0.5rem', padding: '0 0.75rem', fontSize: '0.875rem', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)', width: '100%' }}
              >
                <option value="">— {t('organizations.fields.notInformed')}</option>
                {sourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{ padding: '6px 14px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)' }}
              >
                {t('organizations.modal.back')}
              </button>
              <Button type="submit" loading={mutation.isPending}>
                {mutation.isPending ? t('organizations.modal.submitting') : t('organizations.modal.submit')}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
