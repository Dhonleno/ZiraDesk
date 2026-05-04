import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import type { CrmContact } from '../../services/api';
import { contactsApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

const schema = z.object({
  name:       z.string().min(2),
  whatsapp:   z.string().optional(),
  phone:      z.string().optional(),
  email:      z.union([z.string().email(), z.literal('')]).optional(),
  document:   z.string().optional(),
  role:       z.string().optional(),
  department: z.string().optional(),
  is_primary: z.boolean(),
  tags:       z.array(z.string()),
  notes:      z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  contact: CrmContact | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function EditContactModal({ contact, onClose, onSuccess }: Props) {
  const { t } = useTranslation('crm');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tagInput, setTagInput] = useState('');

  const { register, handleSubmit, watch, setValue, getValues, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { is_primary: false, tags: [] },
  });

  const tags = watch('tags');

  useEffect(() => {
    if (!contact) return;
    reset({
      name:       contact.name,
      whatsapp:   contact.whatsapp ?? '',
      phone:      contact.phone ?? '',
      email:      contact.email ?? '',
      document:   contact.document ?? '',
      role:       contact.role ?? '',
      department: contact.department ?? '',
      is_primary: contact.is_primary,
      tags:       contact.tags ?? [],
      notes:      contact.notes ?? '',
    });
  }, [contact, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => contactsApi.update(contact!.id, {
      name:       values.name,
      whatsapp:   values.whatsapp || null,
      phone:      values.phone || null,
      email:      values.email || null,
      document:   values.document || null,
      role:       values.role || null,
      department: values.department || null,
      is_primary: values.is_primary,
      tags:       values.tags,
      notes:      values.notes || null,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      if (contact?.id) {
        void queryClient.invalidateQueries({ queryKey: ['crm-contact', contact.id] });
      }
      if (contact?.organization_id) {
        void queryClient.invalidateQueries({ queryKey: ['org-contacts', contact.organization_id] });
      }
      toast.success(t('contacts.messages.updated'));
      onSuccess?.();
      onClose();
    },
    onError: () => {
      toast.error('Erro ao atualizar contato');
    },
  });

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
    <Modal open={!!contact} onClose={onClose} title={t('contacts.modal.editTitle')} maxWidth="md">
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))}>
        <div className="space-y-4">
          <Input label={t('contacts.fields.name')} error={errors.name?.message} autoFocus {...register('name')} />

          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contacts.fields.whatsapp')} type="tel" {...register('whatsapp')} />
            <Input label={t('contacts.fields.phone')} type="tel" {...register('phone')} />
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

          {contact?.organization_id && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="is_primary_edit" {...register('is_primary')} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--teal)' }} />
              <label htmlFor="is_primary_edit" style={{ fontSize: 13, color: 'var(--txt-2)', cursor: 'pointer' }}>{t('contacts.fields.isPrimary')}</label>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>{t('contacts.fields.notes')}</label>
            <textarea
              {...register('notes')}
              rows={3}
              style={{ width: '100%', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.875rem', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)', resize: 'vertical' }}
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('contacts.modal.submittingEdit') : t('contacts.modal.submitEdit')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
