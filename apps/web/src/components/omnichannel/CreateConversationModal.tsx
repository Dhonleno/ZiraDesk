import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { omnichannelApi, contactsApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useDebounce } from '../../hooks/useDebounce';
import { avatarClass } from '../../utils/avatar';

const schema = z.object({
  contact_id: z.string().min(1),
  channel_id: z.string().min(1),
  subject: z.string().max(255).optional(),
  initial_message: z.string().max(4000).optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

export function CreateConversationModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const qc = useQueryClient();
  const [contactSearch, setContactSearch] = useState('');
  const [contactLabel, setContactLabel] = useState('');
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [duplicateExistingId, setDuplicateExistingId] = useState<string | null>(null);
  const debouncedSearch = useDebounce(contactSearch, 300);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const selectedContactId = watch('contact_id');
  const selectedChannelId = watch('channel_id');

  const { data: channels = [] } = useQuery({
    queryKey: ['omnichannel-conversation-channels'],
    queryFn: () => omnichannelApi.listConversationChannels(),
  });
  const activeChannels = channels.filter((channel) => channel.status === 'active');

  const { data: contactsResult } = useQuery({
    queryKey: ['crm-contacts-search', debouncedSearch],
    queryFn: () => contactsApi.list({ ...(debouncedSearch ? { search: debouncedSearch } : {}), per_page: 10 }),
    enabled: showContactDropdown,
  });
  const contactsList = contactsResult?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: FormData) =>
      omnichannelApi.createConversation({
        contact_id: data.contact_id,
        channel_id: data.channel_id,
        type: 'inbound',
        ...(data.subject?.trim() ? { subject: data.subject.trim() } : {}),
        ...(data.initial_message?.trim() ? { initial_message: data.initial_message.trim() } : {}),
      }),
    onSuccess: ({ conversation }) => {
      setDuplicateExistingId(null);
      toast.success(t('form.created'));
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
      onCreated(conversation.id);
      onClose();
    },
    onError: (error: unknown) => {
      const response = (error as { response?: { status?: number; data?: { error?: unknown; existingId?: string } } })?.response;
      if (response?.status === 409 && response.data?.error === 'DUPLICATE_OPEN_CONVERSATION' && response.data.existingId) {
        setDuplicateExistingId(response.data.existingId);
        return;
      }
      const errorObj = (response?.data as { error?: { code?: string } } | undefined)?.error;
      if (errorObj?.code === 'WHATSAPP_WINDOW_EXPIRED') {
        toast.warning(t('form.whatsappWindowExpired'), { durationMs: 10000 });
        return;
      }
      setDuplicateExistingId(null);
      toast.error(t('form.errorCreate'));
    },
  });

  const onSubmit = handleSubmit((data) => createMutation.mutate(data));

  const handleSelectContact = useCallback(
    (id: string, name: string) => {
      setDuplicateExistingId(null);
      setValue('contact_id', id, { shouldValidate: true });
      setContactLabel(name);
      setShowContactDropdown(false);
      setContactSearch('');
    },
    [setValue],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!selectedChannelId && activeChannels.length === 1) {
      setValue('channel_id', activeChannels[0]!.id, { shouldValidate: true });
      return;
    }

    if (
      selectedChannelId
      && activeChannels.length > 0
      && !activeChannels.some((channel) => channel.id === selectedChannelId)
    ) {
      setValue('channel_id', '', { shouldValidate: true });
    }
  }, [activeChannels, selectedChannelId, setValue]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--backdrop)',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('form.title')}
    >
      <div
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-pop)',
          width: '100%',
          maxWidth: 460,
          maxHeight: 'calc(100vh - 32px)',
          margin: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--r)',
                background: 'var(--teal-dim)',
                border: '1px solid rgba(0,201,167,.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--teal)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{t('form.title')}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              borderRadius: 'var(--r)',
              color: 'var(--txt-3)',
              cursor: 'pointer',
            }}
            aria-label={t('resolve.cancel')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('form.client')} *
            </label>
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--bg-3)',
                  border: `1px solid ${errors.contact_id ? 'var(--red)' : selectedContactId ? 'rgba(0,201,167,.3)' : 'var(--line-2)'}`,
                  borderRadius: 'var(--r)',
                  padding: '9px 12px',
                }}
              >
                {selectedContactId ? (
                  <>
                    <div
                      className={avatarClass(contactLabel)}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      {contactLabel.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--txt)' }}>{contactLabel}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setValue('contact_id', '', { shouldValidate: true });
                        setContactLabel('');
                        setShowContactDropdown(true);
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-3)', display: 'flex', padding: 0 }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
                      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    <input
                      type="text"
                      placeholder={t('form.clientPlaceholder')}
                      value={contactSearch}
                      onChange={(event) => {
                        setContactSearch(event.target.value);
                        setShowContactDropdown(true);
                      }}
                      onFocus={() => setShowContactDropdown(true)}
                      style={{ flex: 1, background: 'none', border: 'none', fontSize: 13, fontFamily: 'var(--font)', color: 'var(--txt)' }}
                    />
                  </>
                )}
              </div>

              {showContactDropdown && !selectedContactId && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    background: 'var(--bg-3)',
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r)',
                    marginTop: 4,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    maxHeight: 200,
                    overflowY: 'auto',
                  }}
                >
                  {contactsList.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--txt-3)', textAlign: 'center' }}>
                      {t('noConversations')}
                    </div>
                  ) : contactsList.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => handleSelectContact(contact.id, contact.name)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 14px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--txt)',
                        fontSize: 13,
                        fontFamily: 'var(--font)',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <div
                        className={avatarClass(contact.name)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 500,
                          flexShrink: 0,
                        }}
                      >
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{contact.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{contact.email ?? contact.phone ?? ''}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input type="hidden" {...register('contact_id')} />
            {errors.contact_id && (
              <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{t('form.clientRequired')}</p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('form.channel')} *
            </label>
            <select
              {...register('channel_id')}
              style={{
                width: '100%',
                background: 'var(--bg-3)',
                border: `1px solid ${errors.channel_id ? 'var(--red)' : 'var(--line-2)'}`,
                borderRadius: 'var(--r)',
                padding: '9px 12px',
                fontSize: 13,
                fontFamily: 'var(--font)',
                color: selectedChannelId ? 'var(--txt)' : 'var(--txt-3)',
                cursor: 'pointer',
                appearance: 'none',
              }}
            >
              <option value="">{t('form.channelPlaceholder')}</option>
              {activeChannels.map((channel) => (
                <option key={channel.id} value={channel.id} style={{ background: 'var(--bg-3)' }}>
                  {channel.name} ({channel.type})
                </option>
              ))}
            </select>
            {errors.channel_id && (
              <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{t('form.channelRequired')}</p>
            )}
          </div>

          {duplicateExistingId && (
            <div
              style={{
                display: 'grid',
                gap: 8,
                border: '1px solid rgba(245,158,11,.28)',
                borderRadius: 'var(--r)',
                background: 'var(--amber-dim)',
                color: 'var(--amber)',
                padding: '10px 12px',
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              <span>Já existe uma conversa aberta com este contato neste canal.</span>
              <button
                type="button"
                onClick={() => {
                  onCreated(duplicateExistingId);
                  onClose();
                }}
                style={{
                  width: 'fit-content',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--teal)',
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: 'var(--font)',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                Abrir conversa existente
              </button>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('form.subject')}
            </label>
            <input
              type="text"
              {...register('subject')}
              placeholder={t('form.subjectPlaceholder')}
              style={{
                width: '100%',
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                padding: '9px 12px',
                fontSize: 13,
                fontFamily: 'var(--font)',
                color: 'var(--txt)',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('form.initialMessage')}
            </label>
            <textarea
              {...register('initial_message')}
              placeholder={t('form.initialMessagePlaceholder')}
              rows={3}
              style={{
                width: '100%',
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                padding: '9px 12px',
                fontSize: 13,
                fontFamily: 'var(--font)',
                color: 'var(--txt)',
                resize: 'vertical',
                lineHeight: 1.5,
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)',
                background: 'var(--bg-4)',
                color: 'var(--txt-2)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font)',
              }}
            >
              {t('resolve.cancel')}
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: 'var(--on-teal)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity: createMutation.isPending ? 0.7 : 1,
              }}
            >
              {createMutation.isPending ? t('form.creating') : t('form.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
