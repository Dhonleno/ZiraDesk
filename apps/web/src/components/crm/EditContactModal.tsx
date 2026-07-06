import { useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { PhoneInput } from '../ui/PhoneInput';
import { ContactTagSelector } from './ContactTagSelector';
import type { ContactTag, CrmContact } from '../../services/api';
import { contactsApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { isValidOptionalPhone } from '../../lib/phone';

const buildSchema = (invalidPhoneMessage: string) => z.object({
  name:       z.string().min(2),
  phone:      z.string().optional().refine(isValidOptionalPhone, { message: invalidPhoneMessage }),
  email:      z.union([z.string().email(), z.literal('')]).optional(),
  document:   z.string().optional(),
  role:       z.string().optional(),
  department: z.string().optional(),
  is_primary: z.boolean(),
  tag_ids:    z.array(z.string().uuid()),
  notes:      z.string().optional(),
});

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  contact: CrmContact | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function EditContactModal({ contact, onClose, onSuccess }: Props) {
  const { t } = useTranslation(['crm', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const initializedTagsForContact = useRef<string | null>(null);
  const schema = useMemo(() => buildSchema(t('phone.invalid', { ns: 'common' })), [t]);

  const { register, handleSubmit, watch, setValue, reset, setError, clearErrors, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { is_primary: false, tag_ids: [] },
  });

  const tagIds = watch('tag_ids');
  const phoneValue = watch('phone') ?? '';
  const contactTagsQuery = useQuery({
    queryKey: ['contact-tags'],
    queryFn: contactsApi.listTags,
    enabled: Boolean(contact),
  });
  const assignedTagsQuery = useQuery({
    queryKey: ['contact-tags-assigned', contact?.id],
    queryFn: () => contactsApi.getTags(contact!.id),
    enabled: Boolean(contact?.id),
  });
  const selectableTags = useMemo(() => {
    const tagsById = new Map<string, ContactTag>();
    for (const tag of contactTagsQuery.data ?? []) tagsById.set(tag.id, tag);
    for (const tag of assignedTagsQuery.data ?? []) tagsById.set(tag.id, tag);
    return [...tagsById.values()];
  }, [assignedTagsQuery.data, contactTagsQuery.data]);

  useEffect(() => {
    if (!contact) {
      initializedTagsForContact.current = null;
      return;
    }
    initializedTagsForContact.current = null;
    reset({
      name:       contact.name,
      phone:      contact.phone ?? contact.whatsapp ?? '',
      email:      contact.email ?? '',
      document:   contact.document ?? '',
      role:       contact.role ?? '',
      department: contact.department ?? '',
      is_primary: contact.is_primary,
      tag_ids:    [],
      notes:      contact.notes ?? '',
    });
  }, [contact, reset]);

  useEffect(() => {
    if (!contact || assignedTagsQuery.data === undefined) return;
    if (initializedTagsForContact.current === contact.id) return;

    setValue('tag_ids', assignedTagsQuery.data.map((tag) => tag.id));
    initializedTagsForContact.current = contact.id;
  }, [assignedTagsQuery.data, contact, setValue]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => contactsApi.update(contact!.id, {
      name:       values.name,
      phone:      values.phone || null,
      email:      values.email || null,
      document:   values.document || null,
      role:       values.role || null,
      department: values.department || null,
      is_primary: values.is_primary,
      tag_ids:    values.tag_ids,
      notes:      values.notes || null,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      if (contact?.id) {
        void queryClient.invalidateQueries({ queryKey: ['crm-contact', contact.id] });
        void queryClient.invalidateQueries({ queryKey: ['contact-tags-assigned', contact.id] });
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

  return (
    <Modal open={!!contact} onClose={onClose} title={t('contacts.modal.editTitle')} maxWidth="md">
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

          <ContactTagSelector
            tags={selectableTags}
            selectedTagIds={tagIds}
            loading={contactTagsQuery.isLoading || assignedTagsQuery.isLoading}
            error={contactTagsQuery.isError || assignedTagsQuery.isError}
            disabled={mutation.isPending}
            onChange={(nextTagIds) => setValue('tag_ids', nextTagIds, { shouldDirty: true })}
          />

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
