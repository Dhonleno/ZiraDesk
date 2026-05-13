import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { PhoneInput } from '../ui/PhoneInput';
import { contactsApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { isValidOptionalPhone } from '../../lib/phone';

const buildSchema = (invalidPhoneMessage: string) => z.object({
  name:       z.string().min(2, 'Mínimo 2 caracteres'),
  email:      z.union([z.string().email('E-mail inválido'), z.literal('')]).optional(),
  phone:      z.string().optional().refine(isValidOptionalPhone, { message: invalidPhoneMessage }),
  whatsapp:   z.string().optional().refine(isValidOptionalPhone, { message: invalidPhoneMessage }),
  document:   z.string().optional(),
  role:       z.string().optional(),
  department: z.string().optional(),
  tags:       z.array(z.string()),
});

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateClientModal({ open, onClose }: Props) {
  const { t } = useTranslation(['crm', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tagInput, setTagInput] = useState('');
  const schema = useMemo(() => buildSchema(t('phone.invalid', { ns: 'common' })), [t]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { tags: [] },
  });

  const tags = watch('tags');
  const phoneValue = watch('phone') ?? '';
  const whatsappValue = watch('whatsapp') ?? '';

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: Partial<import('../../services/api').CrmContact> = {
        name: values.name,
        ...(values.email     ? { email:      values.email }     : {}),
        ...(values.phone     ? { phone:      values.phone }     : {}),
        ...(values.whatsapp  ? { whatsapp:   values.whatsapp }  : {}),
        ...(values.document  ? { document:   values.document }  : {}),
        ...(values.role      ? { role:       values.role }      : {}),
        ...(values.department ? { department: values.department } : {}),
        ...(values.tags.length > 0 ? { tags: values.tags } : {}),
      };
      return contactsApi.create(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success(t('clients.modal.successCreated'));
      handleClose();
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? 'Erro ao criar contato');
    },
  });

  function handleClose() {
    reset();
    setTagInput('');
    onClose();
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
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))}>
        <div className="space-y-4">
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
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('clients.modal.fields.phone')}</label>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('contacts.table.whatsapp')}</label>
              <PhoneInput
                country="BR"
                value={whatsappValue}
                onChange={(nextValue, isValid) => {
                  setValue('whatsapp', nextValue, { shouldDirty: true });
                  if (!nextValue || isValid) {
                    clearErrors('whatsapp');
                    return;
                  }
                  setError('whatsapp', { type: 'manual', message: t('phone.invalid', { ns: 'common' }) });
                }}
                placeholder="11 99999-9999"
                error={errors.whatsapp?.message}
              />
            </div>
            <Input
              label={t('clients.modal.fields.document')}
              {...register('document')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Cargo"
              {...register('role')}
            />
            <Input
              label="Departamento"
              {...register('department')}
            />
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

          <div className="flex justify-end pt-2">
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('clients.modal.submitting') : t('clients.modal.submit')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
