import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { crmApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

/* ── Schema ──────────────────────────────────────────────────────────────── */
const schema = z.object({
  type: z.enum(['person', 'company']),
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  email: z.union([z.string().email('E-mail inválido'), z.literal('')]).optional(),
  phone: z.string().optional(),
  document: z.string().optional(),
  status: z.enum(['lead', 'prospect', 'cliente']),
  address_zip: z.string().optional(),
  address_street: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  segment: z.string().optional(),
  lead_source: z.string().optional(),
  tags: z.array(z.string()),
});

type FormValues = z.infer<typeof schema>;

/* ── Props ───────────────────────────────────────────────────────────────── */
interface Props {
  open: boolean;
  onClose: () => void;
}

/* ── Shared select style ─────────────────────────────────────────────────── */
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

/* ── Component ───────────────────────────────────────────────────────────── */
export function CreateClientModal({ open, onClose }: Props) {
  const { t } = useTranslation('crm');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [tagInput, setTagInput] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'person',
      status: 'lead',
      tags: [],
    },
  });

  const typeValue = watch('type');
  const tags = watch('tags');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name,
        type: values.type,
        status: values.status,
        ...(values.email ? { email: values.email } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.document ? { document: values.document } : {}),
        ...(values.address_zip ? { address_zip: values.address_zip } : {}),
        ...(values.address_street ? { address_street: values.address_street } : {}),
        ...(values.address_city ? { address_city: values.address_city } : {}),
        ...(values.address_state ? { address_state: values.address_state } : {}),
        ...(values.segment ? { segment: values.segment } : {}),
        ...(values.lead_source ? { lead_source: values.lead_source } : {}),
        ...(values.tags.length > 0 ? { tags: values.tags } : {}),
      };
      return crmApi.createClient(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-kpi'] });
      toast.success(t('clients.modal.successCreated'));
      handleClose();
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? t('clients.detail.noActivity'));
    },
  });

  function handleClose() {
    reset();
    setStep(1);
    setTagInput('');
    setCepError(null);
    onClose();
  }

  async function handleNext() {
    const valid = await trigger(['name', 'status']);
    if (valid) setStep(2);
  }

  async function fetchCep(cep: string) {
    const clean = cep.replace(/\D/g, '');
    if (clean.length !== 8) return;
    setCepLoading(true);
    setCepError(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json() as {
        logradouro?: string;
        localidade?: string;
        uf?: string;
        erro?: boolean;
      };
      if (data.erro) {
        setCepError(t('clients.modal.zipError'));
        return;
      }
      if (data.logradouro) setValue('address_street', data.logradouro);
      if (data.localidade) setValue('address_city', data.localidade);
      if (data.uf) setValue('address_state', data.uf);
    } catch {
      setCepError(t('clients.modal.zipError'));
    } finally {
      setCepLoading(false);
    }
  }

  function addTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = tagInput.trim();
    if (!val || tags.includes(val)) return;
    setValue('tags', [...tags, val]);
    setTagInput('');
  }

  function removeTag(tag: string) {
    setValue('tags', getValues('tags').filter((t) => t !== tag));
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('clients.modal.newTitle')} maxWidth="md">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-5 -mt-1">
        {([1, 2] as const).map((s) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: step >= s ? 'var(--teal)' : 'var(--bg-4)',
              border: step >= s ? '1px solid var(--teal)' : '1px solid var(--line-2)',
              color: step >= s ? 'var(--on-teal)' : 'var(--txt-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600, flexShrink: 0,
            }}>{s}</div>
            <span style={{ fontSize: 12, color: step >= s ? 'var(--txt)' : 'var(--txt-3)', fontWeight: step === s ? 500 : 400 }}>
              {t(`clients.modal.step${s}`)}
            </span>
            {s < 2 && <div style={{ width: 24, height: 1, background: 'var(--line-2)', margin: '0 2px' }} />}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit((v) => mutation.mutate(v))}>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Type toggle */}
            <div>
              <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--txt-2)' }}>
                {t('clients.modal.fields.type')}
              </p>
              <div style={{ display: 'flex', background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 8, padding: 2 }}>
                {(['person', 'company'] as const).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setValue('type', tp)}
                    style={{
                      flex: 1, padding: '6px 12px', borderRadius: 6,
                      fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      border: 'none',
                      background: typeValue === tp ? 'var(--bg-5)' : 'transparent',
                      color: typeValue === tp ? 'var(--txt)' : 'var(--txt-3)',
                      transition: 'all .15s', fontFamily: 'var(--font)',
                    }}
                  >
                    {t(`clients.modal.types.${tp}`)}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label={t('clients.modal.fields.name')}
              error={errors.name?.message}
              autoFocus
              {...register('name')}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('clients.modal.fields.email')}
                type="email"
                error={errors.email?.message}
                {...register('email')}
              />
              <Input
                label={t('clients.modal.fields.phone')}
                type="tel"
                {...register('phone')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('clients.modal.fields.document')}
                {...register('document')}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                  {t('clients.modal.fields.status')}
                </label>
                <select style={selectStyle} {...register('status')}>
                  <option value="lead">Lead</option>
                  <option value="prospect">Prospect</option>
                  <option value="cliente">{t('clients.statusLabel.cliente')}</option>
                </select>
                {errors.status && (
                  <p className="text-xs" style={{ color: '#F87171' }}>{errors.status.message}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" onClick={() => void handleNext()}>
                {t('clients.modal.next')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div className="space-y-4">
            {/* CEP */}
            <div>
              <Input
                label={t('clients.modal.fields.zip')}
                placeholder="00000-000"
                {...register('address_zip', {
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    void fetchCep(e.target.value);
                  },
                })}
              />
              {cepLoading && (
                <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>{t('clients.modal.zipLoading')}</p>
              )}
              {cepError && (
                <p className="text-xs mt-1" style={{ color: '#F87171' }}>{cepError}</p>
              )}
            </div>

            <Input
              label={t('clients.modal.fields.street')}
              {...register('address_street')}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('clients.modal.fields.city')}
                {...register('address_city')}
              />
              <Input
                label={t('clients.modal.fields.state')}
                maxLength={2}
                {...register('address_state')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('clients.modal.fields.segment')}
                {...register('segment')}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                  {t('clients.modal.fields.leadSource')}
                </label>
                <select style={selectStyle} {...register('lead_source')}>
                  <option value="">—</option>
                  {(['site', 'indicacao', 'redes_sociais', 'whatsapp', 'outro'] as const).map((src) => (
                    <option key={src} value={src}>{t(`clients.modal.sources.${src}`)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tags */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                {t('clients.modal.fields.tags')}
              </label>
              {tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--teal-dim)', color: 'var(--teal)', border: '1px solid rgba(0,201,167,.25)', fontSize: 12 }}
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', display: 'flex', alignItems: 'center', padding: 0, lineHeight: 1 }}
                        aria-label={`Remover ${tag}`}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                          <path d="M7.5 2.5l-5 5M2.5 2.5l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder={t('clients.modal.tagsHint')}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={addTag}
                style={{
                  height: '2.5rem', width: '100%', borderRadius: '0.5rem',
                  padding: '0 0.75rem', fontSize: '0.875rem',
                  background: 'var(--bg-3)', border: '1px solid var(--line)',
                  color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)',
                }}
              />
            </div>

            <div className="flex justify-between pt-2">
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                {t('clients.modal.back')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {mutation.isPending ? t('clients.modal.submitting') : t('clients.modal.submit')}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
