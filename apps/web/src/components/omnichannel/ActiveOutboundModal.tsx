import { useMemo, useState, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
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

type HeaderMediaType = 'image' | 'video' | 'document';

interface TemplateButton {
  index: number;
  type: string;
  text: string;
  url: string;
  raw: Record<string, unknown>;
}

interface TemplateMeta {
  headerText: string;
  headerFormat: string | null;
  body: string;
  footer: string;
  buttons: TemplateButton[];
}

const emailSchema = z.object({
  subject: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

const headerMediaAccept: Record<HeaderMediaType, string> = {
  image: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain',
};

const headerMediaMimeTypes: Record<HeaderMediaType, Set<string>> = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp']),
  video: new Set(['video/mp4', 'video/3gpp']),
  document: new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ]),
};

function extractVariables(text: string | null | undefined): string[] {
  if (!text) return [];
  const regex = /\{\{\s*(\d+)\s*\}\}/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[1]) ids.add(match[1]);
  }

  return Array.from(ids).sort((a, b) => Number(a) - Number(b));
}

function replaceVariables(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_all, variableId: string) => {
    const value = values[variableId]?.trim();
    return value || `{{${variableId}}}`;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeTemplateComponents(template: ActiveOutboundTemplate | null): Record<string, unknown>[] {
  const fromComponentsJson = template?.components_json;
  if (Array.isArray(fromComponentsJson)) return fromComponentsJson.filter(isRecord);

  const fromComponents = template?.components;
  if (Array.isArray(fromComponents)) return fromComponents.filter(isRecord);

  if (!template) return [];

  const fallback: Record<string, unknown>[] = [];
  if (template.header || template.header_format) {
    fallback.push({
      type: 'HEADER',
      format: template.header_format ?? (template.header ? 'TEXT' : undefined),
      text: template.header ?? undefined,
    });
  }
  fallback.push({ type: 'BODY', text: template.body });
  if (template.footer) fallback.push({ type: 'FOOTER', text: template.footer });
  if (Array.isArray(template.buttons) && template.buttons.length > 0) {
    fallback.push({ type: 'BUTTONS', buttons: template.buttons });
  }
  return fallback;
}

function findComponent(components: Record<string, unknown>[], type: string): Record<string, unknown> | null {
  return components.find((component) => stringField(component.type).toUpperCase() === type) ?? null;
}

function buttonText(button: Record<string, unknown>): string {
  return stringField(button.text) || stringField(button.title) || stringField(button.payload) || stringField(button.phone_number) || stringField(button.url);
}

function parseTemplateMeta(template: ActiveOutboundTemplate | null): TemplateMeta {
  const components = normalizeTemplateComponents(template);
  const header = findComponent(components, 'HEADER');
  const body = findComponent(components, 'BODY');
  const footer = findComponent(components, 'FOOTER');
  const buttonsComponent = findComponent(components, 'BUTTONS');
  const buttons = Array.isArray(buttonsComponent?.buttons)
    ? buttonsComponent.buttons.filter(isRecord).map((button, index) => ({
      index,
      type: stringField(button.type).toUpperCase(),
      text: buttonText(button),
      url: stringField(button.url),
      raw: button,
    }))
    : [];

  const headerFormat = stringField(header?.format || template?.header_format).trim().toUpperCase();
  const headerText = stringField(header?.text ?? template?.header);
  return {
    headerText,
    headerFormat: headerFormat || (headerText ? 'TEXT' : null),
    body: stringField(body?.text ?? template?.body),
    footer: stringField(footer?.text ?? template?.footer),
    buttons,
  };
}

function isTemplateSendable(template: ActiveOutboundTemplate | null): boolean {
  if (!template) return false;
  if (typeof template.is_sendable === 'boolean') return template.is_sendable;
  return template.status === 'approved' && Boolean(template.meta_template_id);
}

function mediaTypeFromHeaderFormat(format: string | null): HeaderMediaType | null {
  const normalized = format?.toUpperCase();
  if (normalized === 'IMAGE') return 'image';
  if (normalized === 'VIDEO') return 'video';
  if (normalized === 'DOCUMENT') return 'document';
  return null;
}

function isDynamicUrlButton(button: TemplateButton): boolean {
  return button.type === 'URL' && extractVariables(button.url).length > 0;
}

function isQuickReplyButton(button: TemplateButton): boolean {
  return button.type === 'QUICK_REPLY';
}

function fieldBorder(error?: string): string {
  return error ? 'var(--red)' : 'var(--line-2)';
}

function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}

export function ActiveOutboundModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [contactSearch, setContactSearch] = useState('');
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);

  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [selectedTemplateLanguage, setSelectedTemplateLanguage] = useState('pt_BR');
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [headerTextValue, setHeaderTextValue] = useState('');
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [headerMediaFile, setHeaderMediaFile] = useState<File | null>(null);
  const [headerMediaUploadedUrl, setHeaderMediaUploadedUrl] = useState('');
  const [headerMediaFileError, setHeaderMediaFileError] = useState('');
  const [headerMediaPreviewUrl, setHeaderMediaPreviewUrl] = useState('');
  const [buttonValues, setButtonValues] = useState<Record<number, string>>({});

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
      const result = await adminApi.listChannelsByTypes(['whatsapp', 'email']);
      return result.filter((channel) => channel.status === 'active' && (channel.type === 'whatsapp' || channel.type === 'email'));
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

  const templateMeta = useMemo(() => parseTemplateMeta(selectedTemplate), [selectedTemplate]);
  const bodyVariables = useMemo(() => extractVariables(templateMeta.body), [templateMeta.body]);
  const headerVariables = useMemo(() => extractVariables(templateMeta.headerText), [templateMeta.headerText]);
  const headerMediaType = useMemo(() => mediaTypeFromHeaderFormat(templateMeta.headerFormat), [templateMeta.headerFormat]);
  const dynamicUrlButtons = useMemo(() => templateMeta.buttons.filter(isDynamicUrlButton), [templateMeta.buttons]);
  const selectedTemplateIsSendable = isTemplateSendable(selectedTemplate);

  const sendableTemplates = useMemo(
    () => templates.filter((template) => isTemplateSendable(template)),
    [templates],
  );

  const previewBody = useMemo(
    () => replaceVariables(templateMeta.body, templateValues),
    [templateMeta.body, templateValues],
  );

  const previewHeaderText = useMemo(
    () => replaceVariables(templateMeta.headerText, headerVariables.length ? { [headerVariables[0] ?? '1']: headerTextValue } : {}),
    [headerTextValue, headerVariables, templateMeta.headerText],
  );

  const displayedHeaderMediaUrl = headerMediaUrl.trim() || headerMediaUploadedUrl || headerMediaPreviewUrl;

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (selectedChannel?.type !== 'whatsapp' || !useTemplate || !selectedTemplate) return errors;

    for (const variableId of bodyVariables) {
      if (!templateValues[variableId]?.trim()) {
        errors[`body:${variableId}`] = t('activeOutbound.validation.bodyVariableRequired', { variable: `{{${variableId}}}` });
      }
    }

    if (templateMeta.headerFormat === 'TEXT' && headerVariables.length > 0 && !headerTextValue.trim()) {
      errors.headerText = t('activeOutbound.validation.headerVariableRequired', { variable: `{{${headerVariables[0] ?? 1}}}` });
    }

    if (headerMediaType) {
      const rawUrl = headerMediaUrl.trim();
      if (rawUrl) {
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            errors.headerMedia = t('activeOutbound.validation.headerMediaUrlInvalid');
          }
        } catch {
          errors.headerMedia = t('activeOutbound.validation.headerMediaUrlInvalid');
        }
      } else if (!headerMediaFile && !headerMediaUploadedUrl) {
        errors.headerMedia = t('activeOutbound.validation.headerMediaRequired');
      }
      if (headerMediaFileError) errors.headerMedia = headerMediaFileError;
    }

    for (const button of dynamicUrlButtons) {
      if (!buttonValues[button.index]?.trim()) {
        errors[`button:${button.index}`] = t('activeOutbound.validation.buttonParameterRequired', { button: button.text || button.url });
      }
    }

    return errors;
  }, [
    bodyVariables,
    buttonValues,
    dynamicUrlButtons,
    headerMediaFile,
    headerMediaFileError,
    headerMediaType,
    headerMediaUploadedUrl,
    headerMediaUrl,
    headerTextValue,
    headerVariables,
    selectedChannel?.type,
    selectedTemplate,
    t,
    templateMeta.headerFormat,
    templateValues,
    useTemplate,
  ]);

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
  const unavailableTemplateCount = templates.length - sendableTemplates.length;
  const hasTemplateValidationErrors = Object.keys(validationErrors).length > 0;
  const canSend = Boolean(selectedContact && selectedChannel)
    && (
      selectedChannel?.type === 'email'
        ? Boolean(subject.trim() && message.trim())
        : selectedChannel?.type !== 'whatsapp'
          || (
            useTemplate
              ? Boolean(selectedTemplateName && selectedTemplateIsSendable && !hasTemplateValidationErrors)
              : Boolean(message.trim())
          )
    );

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
    const defaultValues: Record<string, string> = {};
    for (const variableId of bodyVariables) {
      defaultValues[variableId] = '';
    }
    setTemplateValues(defaultValues);
    setHeaderTextValue('');
    setHeaderMediaUrl('');
    setHeaderMediaFile(null);
    setHeaderMediaUploadedUrl('');
    setHeaderMediaFileError('');
    setButtonValues({});
  }, [selectedTemplate?.id, bodyVariables]);

  useEffect(() => {
    if (!headerMediaFile) {
      setHeaderMediaPreviewUrl('');
      return;
    }

    const objectUrl = URL.createObjectURL(headerMediaFile);
    setHeaderMediaPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [headerMediaFile]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedContact?.id) throw new Error('contact');
      if (!selectedChannel?.id) throw new Error('channel');

      if (selectedChannel.type === 'whatsapp') {
        if (useTemplate) {
          if (!selectedTemplateName) throw new Error('template');
          if (!selectedTemplateIsSendable) throw new Error('templateUnavailable');
          if (hasTemplateValidationErrors) throw new Error('validation');

          let headerMediaPayload: { type: HeaderMediaType; url: string } | undefined;
          if (headerMediaType) {
            let mediaUrl = headerMediaUrl.trim() || headerMediaUploadedUrl;
            if (!mediaUrl && headerMediaFile) {
              const upload = await omnichannelApi.uploadActiveOutboundHeaderMedia(headerMediaFile, headerMediaType);
              mediaUrl = upload.url;
              setHeaderMediaUploadedUrl(upload.url);
            }
            if (!mediaUrl) throw new Error('headerMedia');
            headerMediaPayload = { type: headerMediaType, url: mediaUrl };
          }

          return omnichannelApi.createActiveOutbound({
            contactId: selectedContact.id,
            channelId: selectedChannel.id,
            useTemplate: true,
            templateName: selectedTemplateName,
            templateLanguage: selectedTemplateLanguage,
            bodyParameters: bodyVariables.map((variableId) => templateValues[variableId]?.trim() ?? ''),
            ...(headerVariables.length ? { headerText: headerTextValue.trim() } : {}),
            ...(headerMediaPayload ? { headerMedia: headerMediaPayload } : {}),
            ...(dynamicUrlButtons.length
              ? {
                buttonParameters: dynamicUrlButtons.map((button) => ({
                  index: button.index,
                  subType: 'url',
                  parameters: [buttonValues[button.index]?.trim() ?? ''],
                })),
              }
              : {}),
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
      toast.success(t('activeOutbound.sent'));
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });
      onCreated(conversation.id);
      onClose();
    },
    onError: (error: unknown) => {
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
    setSelectedContact(contact);
    setShowContactDropdown(false);
    setContactSearch('');
  }, []);

  const handleHeaderMediaFile = useCallback((file: File | null) => {
    setHeaderMediaUploadedUrl('');
    setHeaderMediaFileError('');
    if (!file) {
      setHeaderMediaFile(null);
      return;
    }
    if (headerMediaType && !headerMediaMimeTypes[headerMediaType].has(file.type)) {
      setHeaderMediaFile(null);
      setHeaderMediaFileError(t('activeOutbound.validation.headerMediaTypeInvalid'));
      return;
    }
    setHeaderMediaFile(file);
  }, [headerMediaType, t]);

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
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-pop)',
          width: 'min(920px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r)', background: 'var(--teal-dim)', border: '1px solid var(--line-2)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

        <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <section>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t('activeOutbound.selectContact')}
              </label>

              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-3)', border: `1px solid ${selectedContact ? 'var(--teal)' : 'var(--line-2)'}`, borderRadius: 'var(--r)', padding: '9px 12px' }}>
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
                        style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'var(--font)', color: 'var(--txt)', minWidth: 0 }}
                      />
                    </>
                  )}
                </div>

                {showContactDropdown && !selectedContact && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', marginTop: 4, boxShadow: 'var(--shadow-pop)', maxHeight: 220, overflowY: 'auto' }}>
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
                          <span style={{ fontSize: 10, color: 'var(--teal)', background: 'var(--teal-dim)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-pill)', padding: '2px 8px', whiteSpace: 'nowrap' }}>
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
                      border: `1px solid ${useTemplate ? 'var(--teal)' : 'var(--line-2)'}`,
                      background: useTemplate ? 'var(--teal-dim)' : 'var(--bg-3)',
                      color: useTemplate ? 'var(--teal)' : 'var(--txt-2)',
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'var(--font)',
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
                        {templates.map((template) => {
                          const sendable = isTemplateSendable(template);
                          const unavailableLabel = template.unavailable_reason === 'not_synced'
                            ? t('activeOutbound.templateUnavailable.notSynced')
                            : t('activeOutbound.templateUnavailable.notApproved');

                          return (
                            <option
                              key={`${template.name}:${template.language}`}
                              value={`${template.name}::${template.language}`}
                              disabled={!sendable}
                            >
                              {template.display_name ?? template.name} ({template.language}){sendable ? '' : ` - ${unavailableLabel}`}
                            </option>
                          );
                        })}
                      </select>

                      {templates.length > 0 && unavailableTemplateCount > 0 && (
                        <div style={{ fontSize: 11, color: sendableTemplates.length > 0 ? 'var(--txt-3)' : 'var(--amber)' }}>
                          {sendableTemplates.length > 0
                            ? t('activeOutbound.templateUnavailable.hint')
                            : t('activeOutbound.templateUnavailable.noneSendable')}
                        </div>
                      )}

                      {templates.length === 0 && (
                        <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                          {t('activeOutbound.templateUnavailable.empty')}
                        </div>
                      )}

                      {selectedTemplate && (
                        <div style={{ display: 'grid', gap: 10 }}>
                          {templateMeta.headerFormat === 'TEXT' && headerVariables.length > 0 && (
                            <label style={{ display: 'grid', gap: 5 }}>
                              <span style={{ fontSize: 11, color: 'var(--txt-2)', fontWeight: 500 }}>
                                {t('activeOutbound.headerVariable', { variable: `{{${headerVariables[0] ?? 1}}}` })}
                              </span>
                              <input
                                type="text"
                                value={headerTextValue}
                                onChange={(event) => setHeaderTextValue(event.target.value)}
                                placeholder={`{{${headerVariables[0] ?? 1}}}`}
                                style={{ width: '100%', background: 'var(--bg-3)', border: `1px solid ${fieldBorder(validationErrors.headerText)}`, borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
                              />
                              {validationErrors.headerText ? <span style={{ fontSize: 11, color: 'var(--red)' }}>{validationErrors.headerText}</span> : null}
                            </label>
                          )}

                          {headerMediaType && (
                            <div style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontSize: 11, color: 'var(--txt-2)', fontWeight: 500 }}>
                                {t('activeOutbound.headerMedia', { type: t(`activeOutbound.mediaTypes.${headerMediaType}`) })}
                              </span>
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  border: `1px dashed ${fieldBorder(validationErrors.headerMedia)}`,
                                  borderRadius: 'var(--r)',
                                  background: 'var(--bg-3)',
                                  color: 'var(--txt-2)',
                                  padding: '9px 12px',
                                  cursor: 'pointer',
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                                  <path d="M7 1.5v8M3.5 5L7 1.5 10.5 5M2 12.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                                  {headerMediaFile?.name ?? t('activeOutbound.uploadHeaderMedia')}
                                </span>
                                <input
                                  type="file"
                                  accept={headerMediaAccept[headerMediaType]}
                                  onChange={(event) => handleHeaderMediaFile(event.target.files?.[0] ?? null)}
                                  style={{ display: 'none' }}
                                />
                              </label>
                              <input
                                type="url"
                                value={headerMediaUrl}
                                onChange={(event) => {
                                  setHeaderMediaUrl(event.target.value);
                                  setHeaderMediaUploadedUrl('');
                                }}
                                placeholder={t('activeOutbound.headerMediaUrlPlaceholder')}
                                style={{ width: '100%', background: 'var(--bg-3)', border: `1px solid ${fieldBorder(validationErrors.headerMedia)}`, borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
                              />
                              <span style={{ fontSize: 11, color: validationErrors.headerMedia ? 'var(--red)' : 'var(--txt-3)' }}>
                                {validationErrors.headerMedia ?? t('activeOutbound.headerMediaFileHint')}
                              </span>
                            </div>
                          )}

                          {bodyVariables.map((variableId) => (
                            <label key={variableId} style={{ display: 'grid', gap: 5 }}>
                              <span style={{ fontSize: 11, color: 'var(--txt-2)', fontWeight: 500 }}>
                                {t('activeOutbound.bodyVariable', { variable: `{{${variableId}}}` })}
                              </span>
                              <input
                                type="text"
                                value={templateValues[variableId] ?? ''}
                                onChange={(event) => {
                                  setTemplateValues((current) => ({ ...current, [variableId]: event.target.value }));
                                }}
                                placeholder={`{{${variableId}}}`}
                                style={{ width: '100%', background: 'var(--bg-3)', border: `1px solid ${fieldBorder(validationErrors[`body:${variableId}`])}`, borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
                              />
                              {validationErrors[`body:${variableId}`] ? <span style={{ fontSize: 11, color: 'var(--red)' }}>{validationErrors[`body:${variableId}`]}</span> : null}
                            </label>
                          ))}

                          {dynamicUrlButtons.map((button) => (
                            <label key={button.index} style={{ display: 'grid', gap: 5 }}>
                              <span style={{ fontSize: 11, color: 'var(--txt-2)', fontWeight: 500 }}>
                                {t('activeOutbound.dynamicUrlParameter', { button: button.text || button.url })}
                              </span>
                              <input
                                type="text"
                                value={buttonValues[button.index] ?? ''}
                                onChange={(event) => {
                                  setButtonValues((current) => ({ ...current, [button.index]: event.target.value }));
                                }}
                                placeholder="{{1}}"
                                style={{ width: '100%', background: 'var(--bg-3)', border: `1px solid ${fieldBorder(validationErrors[`button:${button.index}`])}`, borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
                              />
                              {validationErrors[`button:${button.index}`] ? <span style={{ fontSize: 11, color: 'var(--red)' }}>{validationErrors[`button:${button.index}`]}</span> : null}
                            </label>
                          ))}
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

          <aside style={{ minWidth: 0, display: 'grid', alignContent: 'start', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('activeOutbound.preview')}
            </div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg)', padding: 14 }}>
              {selectedChannel?.type === 'whatsapp' && useTemplate && selectedTemplate ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ width: 'min(100%, 320px)', borderRadius: 'var(--r-lg)', borderBottomRightRadius: 4, background: 'var(--teal-dim)', border: '1px solid var(--line-2)', color: 'var(--txt)', overflow: 'hidden' }}>
                    {headerMediaType && displayedHeaderMediaUrl ? (
                      <div style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                        {headerMediaType === 'image' ? (
                          <img src={displayedHeaderMediaUrl} alt="" style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'cover' }} />
                        ) : headerMediaType === 'video' ? (
                          <video src={displayedHeaderMediaUrl} controls muted style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, color: 'var(--txt-2)' }}>
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                              <path d="M5 2.5h5l3 3V15.5H5V2.5zM10 2.5V6h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                            </svg>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                              {headerMediaFile?.name ?? fileNameFromUrl(displayedHeaderMediaUrl)}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {templateMeta.headerFormat === 'TEXT' && templateMeta.headerText ? (
                      <div style={{ padding: '10px 12px 0', fontSize: 13, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'pre-wrap' }}>
                        {previewHeaderText}
                      </div>
                    ) : null}

                    <div style={{ padding: '10px 12px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--txt)' }}>
                      {previewBody || t('activeOutbound.previewEmpty')}
                    </div>

                    {templateMeta.footer ? (
                      <div style={{ padding: '0 12px 10px', fontSize: 11, color: 'var(--txt-3)', whiteSpace: 'pre-wrap' }}>
                        {templateMeta.footer}
                      </div>
                    ) : null}

                    {templateMeta.buttons.length > 0 ? (
                      <div style={{ borderTop: '1px solid var(--line)' }}>
                        {templateMeta.buttons.map((button) => (
                          <div key={button.index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 36, padding: '7px 10px', borderTop: button.index === 0 ? 'none' : '1px solid var(--line)', color: 'var(--teal)', fontSize: 12, fontWeight: 500 }}>
                            {isQuickReplyButton(button) ? (
                              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                                <path d="M2 9V3.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1H5l-3 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                                <path d="M5 3H3.5A1.5 1.5 0 0 0 2 4.5v5A1.5 1.5 0 0 0 3.5 11h5A1.5 1.5 0 0 0 10 9.5V8M7 2h4v4M6.5 6.5L11 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {button.text || button.url}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div style={{ minHeight: 180, display: 'grid', placeItems: 'center', border: '1px dashed var(--line-2)', borderRadius: 'var(--r)', color: 'var(--txt-3)', fontSize: 12, textAlign: 'center', padding: 16 }}>
                  {t('activeOutbound.previewEmpty')}
                </div>
              )}
            </div>
          </aside>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minHeight: 18, fontSize: 11, color: 'var(--amber)' }}>
            {selectedChannel?.type === 'whatsapp' && useTemplate ? (
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
            <button type="button" className="tb-btn" onClick={onClose}>
              {t('resolve.cancel')}
            </button>

            <PermissionGate permission="conversations:reply">
              <button
                type="button"
                className="tb-btn tb-btn-primary"
                disabled={createMutation.isPending || !canSend}
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
