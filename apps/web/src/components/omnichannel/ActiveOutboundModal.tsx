import { useMemo, useState, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  contactsApi,
  omnichannelApi,
  type ActiveOutboundTemplate,
  type CrmContact,
} from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';
import { PermissionGate } from '../ui/PermissionGate';
import { avatarClass } from '../../utils/avatar';

interface Props {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

interface ContactOption extends CrmContact {
  totalConversations: number;
}

const emailSchema = z.object({
  subject: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

function extractTemplateVariables(template: ActiveOutboundTemplate | null): string[] {
  if (!template?.body) return [];
  const regex = /\{\{\s*(\d+)\s*\}\}/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template.body)) !== null) {
    if (match[1]) ids.add(match[1]);
  }

  return Array.from(ids).sort((a, b) => Number(a) - Number(b));
}

function renderTemplatePreview(template: ActiveOutboundTemplate | null, values: Record<string, string>): string {
  if (!template?.body) return '';

  return template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_all, variableId: string) => {
    const value = values[variableId]?.trim();
    return value || `{{${variableId}}}`;
  });
}

export function ActiveOutboundModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [contactSearch, setContactSearch] = useState('');
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);
  const [duplicateExistingId, setDuplicateExistingId] = useState<string | null>(null);

  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [selectedTemplateLanguage, setSelectedTemplateLanguage] = useState('pt_BR');
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const debouncedSearch = useDebounce(contactSearch, 250);

  const { data: contactsResult } = useQuery({
    queryKey: ['active-outbound-contacts', debouncedSearch],
    queryFn: async () => {
      const result = await contactsApi.list({
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        per_page: 10,
      });

      const contactsWithStats = await Promise.all(
        result.data.map(async (contact): Promise<ContactOption> => {
          try {
            const stats = await contactsApi.getStats(contact.id);
            return { ...contact, totalConversations: stats.total_conversations };
          } catch {
            return { ...contact, totalConversations: 0 };
          }
        }),
      );

      return contactsWithStats.sort((a, b) => b.totalConversations - a.totalConversations);
    },
    enabled: showContactDropdown,
    staleTime: 60_000,
  });

  const { data: channels = [] } = useQuery({
    queryKey: ['active-outbound-channels'],
    queryFn: async () => {
      const res = await api.get('/omnichannel/conversations/channels');
      const result = res.data.data as { id: string; type: string; name: string; status: string }[];
      return result.filter((channel) => channel.type === 'whatsapp' || channel.type === 'email');
    },
    staleTime: 60_000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['active-outbound-templates', selectedChannelId],
    queryFn: () => omnichannelApi.listActiveOutboundTemplates(selectedChannelId || undefined),
    enabled: Boolean(selectedChannelId),
    staleTime: 60_000,
  });

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.name === selectedTemplateName && template.language === selectedTemplateLanguage) ?? null,
    [templates, selectedTemplateLanguage, selectedTemplateName],
  );

  const templateVariables = useMemo(
    () => extractTemplateVariables(selectedTemplate),
    [selectedTemplate],
  );

  const templatePreview = useMemo(
    () => renderTemplatePreview(selectedTemplate, templateValues),
    [selectedTemplate, templateValues],
  );

  const { data: previousConversations = [] } = useQuery({
    queryKey: ['active-outbound-contact-conversations', selectedContact?.id],
    queryFn: () => omnichannelApi.listConversations({
      ...(selectedContact?.id ? { contact_id: selectedContact.id } : {}),
      perPage: 1,
    }),
    enabled: Boolean(selectedContact?.id),
    staleTime: 30_000,
  });

  const lastConversation = previousConversations[0] ?? null;

  useEffect(() => {
    if (!selectedChannel) return;

    if (selectedChannel.type === 'email') {
      setUseTemplate(false);
      setSelectedTemplateName('');
      setTemplateValues({});
      return;
    }

    if (selectedChannel.type === 'whatsapp') {
      setUseTemplate(true);
      setSelectedTemplateName('');
      setSelectedTemplateLanguage('pt_BR');
      setTemplateValues({});
    }
  }, [selectedChannel]);

  useEffect(() => {
    if (!selectedTemplateName) {
      setTemplateValues({});
      return;
    }

    const defaultValues: Record<string, string> = {};
    for (const variableId of templateVariables) {
      defaultValues[variableId] = templateValues[variableId] ?? '';
    }
    setTemplateValues(defaultValues);
  }, [selectedTemplateName, templateVariables]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedContact?.id) throw new Error('contact');
      if (!selectedChannel?.id) throw new Error('channel');

      if (selectedChannel.type === 'whatsapp') {
        if (useTemplate) {
          if (!selectedTemplateName) throw new Error('template');

          const components = templateVariables.length
            ? [{
              type: 'body',
              parameters: templateVariables.map((variableId) => ({
                type: 'text',
                text: templateValues[variableId]?.trim() ?? '',
              })),
            }]
            : [];

          return omnichannelApi.createActiveOutbound({
            contactId: selectedContact.id,
            channelId: selectedChannel.id,
            useTemplate: true,
            templateName: selectedTemplateName,
            templateLanguage: selectedTemplateLanguage,
            templateComponents: components,
          });
        }

        if (!message.trim()) throw new Error('message');

        return omnichannelApi.createActiveOutbound({
          contactId: selectedContact.id,
          channelId: selectedChannel.id,
          useTemplate: false,
          message: message.trim(),
        });
      }

      emailSchema.parse({ subject, message });

      return omnichannelApi.createActiveOutbound({
        contactId: selectedContact.id,
        channelId: selectedChannel.id,
        useTemplate: false,
        subject: subject.trim(),
        message: message.trim(),
      });
    },
    onSuccess: (conversation) => {
      setDuplicateExistingId(null);
      toast.success(t('activeOutbound.sent'));
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });
      onCreated(conversation.id);
      onClose();
    },
    onError: (error: unknown) => {
      const response = (
        error as {
          response?: {
            status?: number;
            data?: {
              error?: unknown;
              existingId?: string;
            };
          };
        }
      )?.response;
      if (response?.status === 409 && response.data?.error === 'DUPLICATE_OPEN_CONVERSATION' && response.data.existingId) {
        setDuplicateExistingId(response.data.existingId);
        return;
      }
      setDuplicateExistingId(null);
      const apiMessage = (
        error as {
          response?: {
            data?: {
              error?: { message?: string };
            };
          };
        }
      )?.response?.data?.error?.message;
      toast.error(apiMessage ?? t('form.errorCreate'));
    },
  });

  const handleSelectContact = useCallback((contact: ContactOption) => {
    setDuplicateExistingId(null);
    setSelectedContact(contact);
    setShowContactDropdown(false);
    setContactSearch('');
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--backdrop)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('activeOutbound.title')}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-pop)',
          width: '100%',
          maxWidth: 560,
          maxHeight: 'calc(100vh - 32px)',
          margin: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r)', background: 'var(--teal-dim)', border: '1px solid rgba(0,201,167,.2)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2.5 11.5L11.5 2.5M11.5 2.5H5.5M11.5 2.5V8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{t('activeOutbound.title')}</div>
              <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>{t('activeOutbound.subtitle')}</div>
            </div>
          </div>

          <button type="button" onClick={onClose} className="tb-icon-btn" aria-label={t('resolve.cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          <section>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('activeOutbound.selectContact')}
            </label>

            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-3)', border: `1px solid ${selectedContact ? 'rgba(0,201,167,.3)' : 'var(--line-2)'}`, borderRadius: 'var(--r)', padding: '9px 12px' }}>
                {selectedContact ? (
                  <>
                    <div className={avatarClass(selectedContact.name)} style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>
                      {selectedContact.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--txt)' }}>{selectedContact.name}</span>
                    <button type="button" className="tb-icon-btn" style={{ width: 20, height: 20 }} onClick={() => setSelectedContact(null)}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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
                      value={contactSearch}
                      onChange={(event) => {
                        setContactSearch(event.target.value);
                        setShowContactDropdown(true);
                      }}
                      onFocus={() => setShowContactDropdown(true)}
                      placeholder={t('form.clientPlaceholder')}
                      style={{ flex: 1, background: 'none', border: 'none', fontSize: 13, fontFamily: 'var(--font)', color: 'var(--txt)' }}
                    />
                  </>
                )}
              </div>

              {showContactDropdown && !selectedContact && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', maxHeight: 220, overflowY: 'auto' }}>
                  {(contactsResult ?? []).length === 0 ? (
                    <div style={{ padding: '12px 14px', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>
                      {t('noConversations')}
                    </div>
                  ) : (contactsResult ?? []).map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => handleSelectContact(contact)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', borderBottom: '1px solid var(--line)', padding: '10px 14px', cursor: 'pointer', textAlign: 'left', color: 'var(--txt)' }}
                    >
                      <div className={avatarClass(contact.name)} style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500 }}>
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{contact.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--txt-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {contact.whatsapp ?? contact.phone ?? contact.email ?? ''}
                        </div>
                      </div>
                      {contact.totalConversations > 0 ? (
                        <span style={{ fontSize: 10, color: 'var(--teal)', background: 'var(--teal-dim)', border: '1px solid rgba(0,201,167,.25)', borderRadius: 'var(--r-pill)', padding: '2px 8px', whiteSpace: 'nowrap' }}>
                          {contact.totalConversations}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedContact && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--txt-2)' }}>
                <strong style={{ color: 'var(--txt-2)' }}>{t('activeOutbound.lastContact')}:</strong>{' '}
                {lastConversation
                  ? `${lastConversation.subject ?? lastConversation.last_message ?? t('status.open')} (${lastConversation.status})`
                  : t('activeOutbound.noHistory')}
              </div>
            )}
          </section>

          <section>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('activeOutbound.selectChannel')}
            </label>
            <select
              value={selectedChannelId}
              onChange={(event) => setSelectedChannelId(event.target.value)}
              style={{ width: '100%', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font)', color: selectedChannelId ? 'var(--txt)' : 'var(--txt-3)', appearance: 'none' }}
            >
              <option value="">{t('form.channelPlaceholder')}</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name} ({channel.type})
                </option>
              ))}
            </select>
          </section>

          <section>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('activeOutbound.composeMessage')}
            </label>

            {selectedChannel?.type === 'whatsapp' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setUseTemplate((current) => !current)}
                  style={{
                    width: 'fit-content',
                    borderRadius: 'var(--r-pill)',
                    border: `1px solid ${useTemplate ? 'rgba(0,201,167,.4)' : 'var(--line-2)'}`,
                    background: useTemplate ? 'var(--teal-dim)' : 'var(--bg-3)',
                    color: useTemplate ? 'var(--teal)' : 'var(--txt-2)',
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {t('activeOutbound.useTemplate')}
                </button>

                {useTemplate ? (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{t('activeOutbound.templateWarning')}</div>

                    <select
                      value={selectedTemplateName ? `${selectedTemplateName}::${selectedTemplateLanguage}` : ''}
                      onChange={(event) => {
                        const [name, language] = event.target.value.split('::');
                        setSelectedTemplateName(name ?? '');
                        setSelectedTemplateLanguage(language ?? 'pt_BR');
                      }}
                      style={{ width: '100%', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: selectedTemplateName ? 'var(--txt)' : 'var(--txt-3)', fontFamily: 'var(--font)' }}
                    >
                      <option value="">{t('chat.templateNamePlaceholder')}</option>
                      {templates.map((template) => (
                        <option key={`${template.name}:${template.language}`} value={`${template.name}::${template.language}`}>
                          {template.display_name ?? template.name} ({template.language})
                        </option>
                      ))}
                    </select>

                    {templateVariables.map((variableId) => (
                      <input
                        key={variableId}
                        type="text"
                        value={templateValues[variableId] ?? ''}
                        onChange={(event) => {
                          setTemplateValues((current) => ({ ...current, [variableId]: event.target.value }));
                        }}
                        placeholder={`{{${variableId}}}`}
                        style={{ width: '100%', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
                      />
                    ))}

                    {templatePreview && (
                      <div style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r)', background: 'var(--bg-3)', padding: 10, fontSize: 12, color: 'var(--txt-2)', whiteSpace: 'pre-wrap' }}>
                        {templatePreview}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--amber)' }}>{t('activeOutbound.freeMessageWarning')}</div>
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      rows={4}
                      placeholder={t('form.initialMessageOutboundPlaceholder')}
                      style={{ width: '100%', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)', resize: 'vertical', lineHeight: 1.5 }}
                    />
                  </>
                )}
              </div>
            )}

            {selectedChannel?.type === 'email' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <input
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder={t('form.subject')}
                  style={{ width: '100%', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
                />
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  placeholder={t('form.initialMessage')}
                  style={{ width: '100%', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)', resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>
            )}

            {!selectedChannel && (
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{t('form.channelPlaceholder')}</div>
            )}
          </section>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minHeight: 18, fontSize: 11, color: duplicateExistingId ? 'var(--amber)' : 'var(--amber)', display: 'grid', gap: 4 }}>
            {duplicateExistingId ? (
              <>
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
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: 'var(--font)',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  Abrir conversa existente
                </button>
              </>
            ) : selectedChannel?.type === 'whatsapp' && useTemplate ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {t('activeOutbound.costWarning')}
              </span>
            ) : ''}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="topbar-search-btn" style={{ minWidth: 0, width: 'auto' }} onClick={onClose}>
              {t('resolve.cancel')}
            </button>

            <PermissionGate permission="conversations:reply">
              <button
                type="button"
                className="topbar-primary-btn"
                disabled={createMutation.isPending || !selectedContact || !selectedChannel}
                onClick={() => createMutation.mutate()}
                title={t('activeOutbound.send')}
                aria-label={t('activeOutbound.send')}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 10L10 6 2 2l1.6 3.1L8 6l-4.4.9L2 10z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {createMutation.isPending ? t('form.creating') : t('activeOutbound.send')}
              </button>
            </PermissionGate>
          </div>
        </div>
      </div>
    </div>
  );
}
