import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { omnichannelApi, adminApi, crmApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useDebounce } from '../../hooks/useDebounce';

const schema = z.object({
  client_id: z.string().min(1),
  channel_id: z.string().min(1),
  type: z.enum(['inbound', 'outbound']),
  subject: z.string().optional(),
  initial_message: z.string().optional(),
}).refine((data) => data.type !== 'outbound' || Boolean(data.initial_message?.trim()), {
  path: ['initial_message'],
  message: 'initialMessageRequired',
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
  const [clientSearch, setClientSearch] = useState('');
  const [clientLabel, setClientLabel] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const debouncedSearch = useDebounce(clientSearch, 300);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'inbound' },
  });

  const selectedClientId = watch('client_id');
  const selectedChannelId = watch('channel_id');
  const selectedType = watch('type') ?? 'inbound';

  // Load channels
  const { data: channels = [] } = useQuery({
    queryKey: ['admin-channels'],
    queryFn: () => adminApi.listChannels(),
  });

  // Search clients
  const { data: clientsResult } = useQuery({
    queryKey: ['crm-clients-search', debouncedSearch],
    queryFn: () => crmApi.listClients({ ...(debouncedSearch ? { search: debouncedSearch } : {}), per_page: 10 }),
    enabled: showClientDropdown,
  });
  const clientsList = clientsResult?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: FormData) =>
      omnichannelApi.createConversation({
        client_id: data.client_id,
        channel_id: data.channel_id,
        type: data.type,
        ...(data.subject ? { subject: data.subject } : {}),
        ...(data.initial_message ? { initial_message: data.initial_message } : {}),
      }),
    onSuccess: (conv) => {
      toast.success(t('form.created'));
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
      onCreated(conv.id);
      onClose();
    },
    onError: () => toast.error(t('form.errorCreate')),
  });

  const onSubmit = handleSubmit((data) => createMutation.mutate(data));

  const handleSelectClient = useCallback(
    (id: string, name: string) => {
      setValue('client_id', id, { shouldValidate: true });
      setClientLabel(name);
      setShowClientDropdown(false);
      setClientSearch('');
    },
    [setValue],
  );

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--backdrop)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t('form.title')}
    >
      <div style={{
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
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 'var(--r)',
              background: 'var(--teal-dim)', border: '1px solid rgba(0,201,167,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)',
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{t('form.title')}</span>
          </div>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 'var(--r)', color: 'var(--txt-3)', cursor: 'pointer' }}
            aria-label="Fechar"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>

          {/* Type */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('form.type')} *
            </label>
            <input type="hidden" {...register('type')} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={() => setValue('type', 'inbound', { shouldValidate: true })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  background: selectedType === 'inbound' ? 'var(--teal-dim)' : 'var(--bg-3)',
                  border: `1px solid ${selectedType === 'inbound' ? 'var(--teal)' : 'var(--line-2)'}`,
                  borderRadius: 'var(--r-lg)',
                  padding: 12,
                  color: selectedType === 'inbound' ? 'var(--teal)' : 'var(--txt-2)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }} aria-hidden>
                  <path d="M4 10h12M10 4l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 13, marginBottom: 2, color: selectedType === 'inbound' ? 'var(--teal)' : 'var(--txt)' }}>
                    {t('form.typeInbound')}
                  </strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--txt-3)' }}>
                    {t('form.typeInboundHelp')}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setValue('type', 'outbound', { shouldValidate: true })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  background: selectedType === 'outbound' ? 'var(--teal-dim)' : 'var(--bg-3)',
                  border: `1px solid ${selectedType === 'outbound' ? 'var(--teal)' : 'var(--line-2)'}`,
                  borderRadius: 'var(--r-lg)',
                  padding: 12,
                  color: selectedType === 'outbound' ? 'var(--teal)' : 'var(--txt-2)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }} aria-hidden>
                  <path d="M16 10H4M10 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 13, marginBottom: 2, color: selectedType === 'outbound' ? 'var(--teal)' : 'var(--txt)' }}>
                    {t('form.typeOutbound')}
                  </strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--txt-3)' }}>
                    {t('form.typeOutboundHelp')}
                  </span>
                </span>
              </button>
            </div>
          </div>

          {/* Client search */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('form.client')} *
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg-3)', border: `1px solid ${errors.client_id ? 'var(--red)' : selectedClientId ? 'rgba(0,201,167,.3)' : 'var(--line-2)'}`,
                borderRadius: 'var(--r)', padding: '9px 12px',
                transition: 'border-color .15s',
              }}>
                {selectedClientId ? (
                  <>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#667eea,#764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
                      {clientLabel.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--txt)' }}>{clientLabel}</span>
                    <button
                      type="button"
                      onClick={() => { setValue('client_id', '', { shouldValidate: true }); setClientLabel(''); setShowClientDropdown(true); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-3)', display: 'flex', padding: 0 }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
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
                      value={clientSearch}
                      onChange={(e) => { setClientSearch(e.target.value); setShowClientDropdown(true); }}
                      onFocus={() => setShowClientDropdown(true)}
                      style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'var(--font)', color: 'var(--txt)' }}
                    />
                  </>
                )}
              </div>
              {showClientDropdown && !selectedClientId && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  background: 'var(--bg-3)', border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)', marginTop: 4,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  maxHeight: 200, overflowY: 'auto',
                }}>
                  {clientsList.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--txt-3)', textAlign: 'center' }}>
                      {t('noConversations')}
                    </div>
                  ) : clientsList.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectClient(c.id, c.name)}
                      style={{
                        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--txt)', fontSize: 13, fontFamily: 'var(--font)',
                        borderBottom: '1px solid var(--line)',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#667eea,#764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{c.email ?? c.phone ?? ''}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Hidden input for validation */}
            <input type="hidden" {...register('client_id')} />
            {errors.client_id && (
              <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{t('form.clientRequired')}</p>
            )}
          </div>

          {/* Channel */}
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
                outline: 'none',
                cursor: 'pointer',
                appearance: 'none',
              }}
            >
              <option value="">{t('form.channelPlaceholder')}</option>
              {channels.filter((ch) => ch.status === 'active').map((ch) => (
                <option key={ch.id} value={ch.id} style={{ background: 'var(--bg-3)' }}>
                  {ch.name} ({ch.type})
                </option>
              ))}
            </select>
            {errors.channel_id && (
              <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{t('form.channelRequired')}</p>
            )}
          </div>

          {/* Subject */}
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
                outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--teal)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--teal-dim)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Initial message */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('form.initialMessage')}{selectedType === 'outbound' ? ' *' : ''}
            </label>
            <textarea
              {...register('initial_message')}
              placeholder={t(selectedType === 'outbound' ? 'form.initialMessageOutboundPlaceholder' : 'form.initialMessagePlaceholder')}
              rows={3}
              style={{
                width: '100%',
                background: 'var(--bg-3)',
                border: `1px solid ${errors.initial_message ? 'var(--red)' : 'var(--line-2)'}`,
                borderRadius: 'var(--r)',
                padding: '9px 12px',
                fontSize: 13,
                fontFamily: 'var(--font)',
                color: 'var(--txt)',
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.5,
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--teal)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--teal-dim)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = errors.initial_message ? 'var(--red)' : 'var(--line-2)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            {errors.initial_message && (
              <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{t('form.initialMessageRequired')}</p>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px', borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)', background: 'var(--bg-4)',
                color: 'var(--txt-2)', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all .15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-5)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              style={{
                padding: '8px 18px', borderRadius: 'var(--r)',
                border: '1px solid var(--teal)', background: 'var(--teal)',
                color: '#0E1A18', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all .15s',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                opacity: createMutation.isPending ? 0.7 : 1,
              }}
            >
              {createMutation.isPending ? (
                <>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(14,26,24,.4)', borderTopColor: '#0E1A18', animation: 'spin 0.7s linear infinite' }} />
                  {t('form.creating')}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2 6.5l3 3 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {t('form.create')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
