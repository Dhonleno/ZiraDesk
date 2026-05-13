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
  name:            z.string().min(2, 'Mínimo 2 caracteres'),
  phone:           z.string().optional().refine(isValidOptionalPhone, { message: invalidPhoneMessage }),
  email:           z.union([z.string().email('E-mail inválido'), z.literal('')]).optional(),
  document:        z.string().optional(),
  role:            z.string().optional(),
  department:      z.string().optional(),
  organization_id: z.string().optional(),
  is_primary:      z.boolean(),
  tags:            z.array(z.string()),
  notes:           z.string().optional(),
});

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  open: boolean;
  onClose: () => void;
  defaultOrganizationId?: string;
}

export function CreateContactModal({ open, onClose, defaultOrganizationId }: Props) {
  const { t } = useTranslation(['crm', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tagInput, setTagInput] = useState('');
  const schema = useMemo(() => buildSchema(t('phone.invalid', { ns: 'common' })), [t]);

  const { register, handleSubmit, watch, setValue, getValues, reset, setError, clearErrors, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { is_primary: false, tags: [], organization_id: defaultOrganizationId ?? '' },
  });

  const tags = watch('tags');
  const phoneValue = watch('phone') ?? '';

  const mutation = useMutation({
    mutationFn: (values: FormValues) => contactsApi.create({
      name:       values.name,
      is_primary: values.is_primary,
      tags:       values.tags,
      ...(values.phone      ? { phone:           values.phone }      : {}),
      ...(values.email      ? { email:           values.email }      : {}),
      ...(values.document   ? { document:        values.document }   : {}),
      ...(values.role       ? { role:            values.role }       : {}),
      ...(values.department ? { department:      values.department } : {}),
      ...(values.organization_id ? { organization_id: values.organization_id } : {}),
      ...(values.notes      ? { notes:           values.notes }      : {}),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      if (defaultOrganizationId) {
        void queryClient.invalidateQueries({ queryKey: ['org-contacts', defaultOrganizationId] });
      }
      toast.success(t('contacts.messages.created'));
      handleClose();
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? 'Erro ao criar contato');
    },
  });

  function handleClose() {
    reset({ is_primary: false, tags: [], organization_id: defaultOrganizationId ?? '' });
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

  const orgId = watch('organization_id');

  return (
    <Modal open={open} onClose={handleClose} title={t('contacts.modal.newTitle')} maxWidth="md">
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))}>
        <div className="space-y-4">
          <Input label={t('contacts.fields.name')} error={errors.name?.message} autoFocus {...register('name')} />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('contacts.fields.phone')}</label>
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
              placeholder="11 99999-9999"
              error={errors.phone?.message}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contacts.fields.email')} type="email" error={errors.email?.message} {...register('email')} />
            <Input label={t('contacts.fields.document')} {...register('document')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contacts.fields.role')} {...register('role')} />
            <Input label={t('contacts.fields.department')} {...register('department')} />
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('contacts.fields.tags')}</label>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                {tags.map((tag) => (
                  <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--teal-dim)', color: 'var(--teal)', border: '1px solid rgba(0,201,167,.25)', fontSize: 12 }}>
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', display: 'flex', alignItems: 'center', padding: 0 }} aria-label={`Remover ${tag}`}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M7.5 2.5l-5 5M2.5 2.5l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              placeholder={t('contacts.fields.tagsHint')}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={addTag}
              style={{ height: '2.5rem', width: '100%', borderRadius: '0.5rem', padding: '0 0.75rem', fontSize: '0.875rem', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)' }}
            />
          </div>

          {/* is_primary toggle — only when org is set */}
          {(orgId || defaultOrganizationId) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="is_primary" {...register('is_primary')} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--teal)' }} />
              <label htmlFor="is_primary" style={{ fontSize: 13, color: 'var(--txt-2)', cursor: 'pointer' }}>{t('contacts.fields.isPrimary')}</label>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('contacts.modal.submitting') : t('contacts.modal.submit')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
