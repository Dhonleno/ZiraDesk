import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  type CreateWhatsAppTemplatePayload,
  type WhatsAppTemplate,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateInputHeaderType,
  type WhatsAppTemplateLanguage,
  type UpdateWhatsAppTemplatePayload,
  type WhatsAppTemplateVariable,
} from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { PageShell } from '../../components/layout/PageShell';
import { useToast } from '../../stores/toast.store';

interface ChannelOption {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface TemplateFormState {
  channelId: string;
  technicalName: string;
  displayName: string;
  language: WhatsAppTemplateLanguage;
  category: WhatsAppTemplateCategory;
  body: string;
  headerType: WhatsAppTemplateInputHeaderType;
  headerText: string;
  headerHandle: string;
  headerFilename: string;
  headerMimeType: string;
  headerPreviewUrl: string;
  footer: string;
  variables: WhatsAppTemplateVariable[];
}

const TECHNICAL_NAME_REGEX = /^[a-z0-9_]+$/;

const DEFAULT_FORM: TemplateFormState = {
  channelId: '',
  technicalName: '',
  displayName: '',
  language: 'pt_BR',
  category: 'MARKETING',
  body: '',
  headerType: 'none',
  headerText: '',
  headerHandle: '',
  headerFilename: '',
  headerMimeType: '',
  headerPreviewUrl: '',
  footer: '',
  variables: [],
};

function extractVariableIndexes(body: string): string[] {
  const regex = /\{\{\s*([^{}\s]+)\s*\}\}/g;
  const unique = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    if (match[1]) unique.add(match[1]);
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function syncVariablesWithBody(body: string, previous: WhatsAppTemplateVariable[]): WhatsAppTemplateVariable[] {
  const indexes = extractVariableIndexes(body);
  return indexes.map((index) => {
    const current = previous.find((item) => item.index === index);
    return {
      index,
      example: current?.example ?? '',
    };
  });
}

function renderBodyWithHighlights(body: string): Array<string | JSX.Element> {
  const regex = /\{\{\s*([^{}\s]+)\s*\}\}/g;
  const parts: Array<string | JSX.Element> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    const full = match[0] ?? '';
    const index = match.index ?? 0;

    if (index > cursor) {
      parts.push(body.slice(cursor, index));
    }

    parts.push(
      <span
        key={`${full}-${index}`}
        style={{
          color: 'var(--teal)',
          background: 'var(--teal-dim)',
          borderRadius: 'var(--r-pill)',
          padding: '1px 6px',
          border: '1px solid rgba(0,201,167,.22)',
          fontFamily: 'var(--mono)',
          fontSize: 11,
        }}
      >
        {full}
      </span>,
    );

    cursor = index + full.length;
  }

  if (cursor < body.length) {
    parts.push(body.slice(cursor));
  }

  return parts;
}

function renderTemplatePreview(body: string, variables: WhatsAppTemplateVariable[]): string {
  if (!body.trim()) return '';

  return body.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_full, index: string) => {
    const found = variables.find((item) => item.index === index);
    const value = found?.example?.trim();
    return value ? value : `{{${index}}}`;
  });
}

function templateStatusColors(status: WhatsAppTemplate['status']): { background: string; color: string } {
  if (status === 'approved') {
    return { background: 'var(--green-dim)', color: 'var(--green)' };
  }
  if (status === 'rejected' || status === 'disabled' || status === 'pending_deletion') {
    return { background: 'var(--red-dim)', color: 'var(--red)' };
  }
  return { background: 'var(--amber-dim)', color: 'var(--amber)' };
}

function templateToForm(template: WhatsAppTemplate): TemplateFormState {
  const headerType = template.header_type.toLowerCase() as WhatsAppTemplateInputHeaderType;
  return {
    channelId: template.channel_id,
    technicalName: template.name,
    displayName: template.display_name,
    language: template.language,
    category: template.category,
    body: template.body,
    headerType,
    headerText: template.header ?? '',
    headerHandle: '',
    headerFilename: '',
    headerMimeType: '',
    headerPreviewUrl: template.header_example_url ?? '',
    footer: template.footer ?? '',
    variables: Array.isArray(template.variables) ? template.variables : [],
  };
}

const MEDIA_RULES: Record<
  Extract<WhatsAppTemplateInputHeaderType, 'image' | 'video' | 'document'>,
  { accept: string; mimeTypes: string[]; maxBytes: number }
> = {
  image: {
    accept: 'image/jpeg,image/png',
    mimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * 1024 * 1024,
  },
  video: {
    accept: 'video/mp4',
    mimeTypes: ['video/mp4'],
    maxBytes: 16 * 1024 * 1024,
  },
  document: {
    accept: 'application/pdf',
    mimeTypes: ['application/pdf'],
    maxBytes: 100 * 1024 * 1024,
  },
};

export function Templates() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<TemplateFormState>(DEFAULT_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncChannelId, setSyncChannelId] = useState('');
  const [selectedHeaderFile, setSelectedHeaderFile] = useState<File | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const localPreviewUrlRef = useRef<string | null>(null);
  const uploadGenerationRef = useRef(0);

  useEffect(() => () => {
    if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
  }, []);

  const { data: channels = [] } = useQuery({
    queryKey: ['admin', 'channels', 'whatsapp-for-templates'],
    queryFn: async () => {
      const allChannels = await adminApi.listChannelsByTypes(['whatsapp']);
      return allChannels.filter((channel) => channel.type === 'whatsapp' && channel.status === 'active') as ChannelOption[];
    },
    staleTime: 60_000,
  });

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['admin', 'templates'],
    queryFn: () => adminApi.templates.list(),
  });

  const templatesByChannel = useMemo(() => {
    const grouped = new Map<string, WhatsAppTemplate[]>();
    for (const template of templates) {
      const current = grouped.get(template.channel_id) ?? [];
      current.push(template);
      grouped.set(template.channel_id, current);
    }
    return grouped;
  }, [templates]);
  const editingTemplate = useMemo(
    () => templates.find((template) => template.id === editingTemplateId) ?? null,
    [editingTemplateId, templates],
  );
  const isMetaManagedTemplate = Boolean(editingTemplate?.meta_template_id);

  const createMutation = useMutation({
    mutationFn: (payload: CreateWhatsAppTemplatePayload) => adminApi.templates.create(payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.templates.submittedSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'templates'] });
      closeFormModal();
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateWhatsAppTemplatePayload }) =>
      adminApi.templates.update(id, payload),
    onSuccess: async () => {
      toast.success(t(
        isMetaManagedTemplate
          ? 'tenantAdmin.templates.savedSuccess'
          : 'tenantAdmin.templates.submittedSuccess',
      ));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'templates'] });
      closeFormModal();
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.templates.remove(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.templates.deletedSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'templates'] });
      setDeleteTemplateId(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const syncMutation = useMutation({
    mutationFn: (channelId: string) => adminApi.templates.sync(channelId),
    onSuccess: async (result) => {
      toast.success(t('tenantAdmin.templates.syncSuccess', { count: result.count }));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'templates'] });
      setSyncOpen(false);
    },
    onError: () => {
      toast.error(t('tenantAdmin.templates.syncError'));
    },
  });

  const mediaUploadMutation = useMutation({
    mutationFn: ({ channelId, file }: { channelId: string; file: File }) =>
      adminApi.templates.uploadMedia(channelId, file),
  });

  function revokeLocalPreview() {
    if (!localPreviewUrlRef.current) return;
    URL.revokeObjectURL(localPreviewUrlRef.current);
    localPreviewUrlRef.current = null;
  }

  function clearHeaderMedia() {
    uploadGenerationRef.current += 1;
    mediaUploadMutation.reset();
    revokeLocalPreview();
    setSelectedHeaderFile(null);
    setFormState((current) => ({
      ...current,
      headerHandle: '',
      headerFilename: '',
      headerMimeType: '',
      headerPreviewUrl: '',
    }));
    setFormErrors((current) => {
      const next = { ...current };
      delete next.headerMedia;
      return next;
    });
    if (mediaInputRef.current) mediaInputRef.current.value = '';
  }

  function closeFormModal() {
    uploadGenerationRef.current += 1;
    mediaUploadMutation.reset();
    revokeLocalPreview();
    setSelectedHeaderFile(null);
    setFormOpen(false);
  }

  function openCreateModal() {
    mediaUploadMutation.reset();
    revokeLocalPreview();
    setSelectedHeaderFile(null);
    setEditingTemplateId(null);
    setFormState({
      ...DEFAULT_FORM,
      channelId: channels[0]?.id ?? '',
    });
    setFormErrors({});
    setFormOpen(true);
  }

  function openEditModal(template: WhatsAppTemplate) {
    mediaUploadMutation.reset();
    revokeLocalPreview();
    setSelectedHeaderFile(null);
    setEditingTemplateId(template.id);
    setFormState(templateToForm(template));
    setFormErrors({});
    setFormOpen(true);
  }

  function handleHeaderTypeChange(headerType: WhatsAppTemplateInputHeaderType) {
    uploadGenerationRef.current += 1;
    mediaUploadMutation.reset();
    revokeLocalPreview();
    setSelectedHeaderFile(null);
    setFormState((current) => ({
      ...current,
      headerType,
      headerText: headerType === 'text' ? current.headerText : '',
      headerHandle: '',
      headerFilename: '',
      headerMimeType: '',
      headerPreviewUrl: '',
    }));
    setFormErrors((current) => {
      const next = { ...current };
      delete next.header;
      delete next.headerMedia;
      return next;
    });
    if (mediaInputRef.current) mediaInputRef.current.value = '';
  }

  function uploadHeaderFile(file: File) {
    const headerType = formState.headerType;
    if (headerType !== 'image' && headerType !== 'video' && headerType !== 'document') return;
    if (!formState.channelId) {
      setFormErrors((current) => ({
        ...current,
        channelId: t('tenantAdmin.templates.channelRequired'),
        headerMedia: t('tenantAdmin.templates.upload.channelRequired'),
      }));
      return;
    }

    const rule = MEDIA_RULES[headerType];
    if (!rule.mimeTypes.includes(file.type)) {
      setFormErrors((current) => ({
        ...current,
        headerMedia: t('tenantAdmin.templates.upload.invalidFormat'),
      }));
      return;
    }
    if (file.size > rule.maxBytes) {
      setFormErrors((current) => ({
        ...current,
        headerMedia: t('tenantAdmin.templates.upload.tooLarge'),
      }));
      return;
    }

    revokeLocalPreview();
    const previewUrl = URL.createObjectURL(file);
    localPreviewUrlRef.current = previewUrl;
    setSelectedHeaderFile(file);
    setFormState((current) => ({
      ...current,
      headerHandle: '',
      headerFilename: file.name,
      headerMimeType: file.type,
      headerPreviewUrl: previewUrl,
    }));
    setFormErrors((current) => {
      const next = { ...current };
      delete next.headerMedia;
      return next;
    });

    const uploadGeneration = ++uploadGenerationRef.current;
    mediaUploadMutation.mutate(
      { channelId: formState.channelId, file },
      {
        onSuccess: (result) => {
          if (uploadGenerationRef.current !== uploadGeneration) return;
          setFormState((current) => ({
            ...current,
            headerHandle: result.header_handle,
            headerFilename: result.filename,
            headerMimeType: result.mime_type,
          }));
        },
        onError: (error: unknown) => {
          if (uploadGenerationRef.current !== uploadGeneration) return;
          const apiError = error as { response?: { data?: { error?: { message?: string } } } };
          setFormErrors((current) => ({
            ...current,
            headerMedia:
              apiError.response?.data?.error?.message
              ?? t('tenantAdmin.templates.upload.error'),
          }));
        },
      },
    );
  }

  function validateForm(state: TemplateFormState): Record<string, string> {
    const errors: Record<string, string> = {};

    if (!state.channelId) errors.channelId = t('tenantAdmin.templates.channelRequired');
    if (!state.technicalName.trim()) {
      errors.technicalName = t('tenantAdmin.templates.technicalNameRequired');
    } else if (!TECHNICAL_NAME_REGEX.test(state.technicalName.trim())) {
      errors.technicalName = t('tenantAdmin.templates.technicalNameHint');
    }

    if (!state.displayName.trim()) errors.displayName = t('tenantAdmin.templates.displayNameRequired');
    if (!state.body.trim()) errors.body = t('tenantAdmin.templates.bodyRequired');
    if (state.body.length > 1024) errors.body = t('tenantAdmin.templates.bodyTooLong');
    if (state.headerType === 'text' && !state.headerText.trim()) {
      errors.header = t('tenantAdmin.templates.headerRequired');
    }
    if (state.headerText.length > 60) errors.header = t('tenantAdmin.templates.headerTooLong');
    if (state.footer.length > 60) errors.footer = t('tenantAdmin.templates.footerTooLong');
    if (/\{\{[^{}]+\}\}/.test(state.headerText)) {
      errors.header = t('tenantAdmin.templates.headerVariablesUnsupported');
    }
    if (
      (state.headerType === 'image' || state.headerType === 'video' || state.headerType === 'document')
      && !state.headerHandle
    ) {
      errors.headerMedia = t('tenantAdmin.templates.upload.required');
    }
    if (/\{\{[^{}]+\}\}/.test(state.footer)) {
      errors.footer = t('tenantAdmin.templates.footerVariablesUnsupported');
    }

    const indexes = extractVariableIndexes(state.body);
    if (indexes.some((index, position) => index !== String(position + 1))) {
      errors.body = t('tenantAdmin.templates.variablesFormat');
    }
    for (const variable of state.variables) {
      if (!variable.example.trim()) {
        errors[`variable.${variable.index}`] = t('tenantAdmin.templates.variableExampleRequired');
      }
    }

    return errors;
  }

  function handleBodyChange(value: string) {
    setFormState((current) => ({
      ...current,
      body: value,
      variables: syncVariablesWithBody(value, current.variables),
    }));
  }

  function handleVariableExampleChange(index: string, value: string) {
    setFormState((current) => ({
      ...current,
      variables: current.variables.map((item) => (item.index === index ? { ...item, example: value } : item)),
    }));
  }

  function handleSubmit() {
    if (mediaUploadMutation.isPending) return;
    const validationErrors = isMetaManagedTemplate
      ? (formState.displayName.trim()
        ? {}
        : { displayName: t('tenantAdmin.templates.displayNameRequired') })
      : validateForm(formState);
    setFormErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    if (editingTemplateId && isMetaManagedTemplate) {
      updateMutation.mutate({
        id: editingTemplateId,
        payload: { displayName: formState.displayName.trim() },
      });
      return;
    }

    const payload: CreateWhatsAppTemplatePayload = {
      channelId: formState.channelId,
      technicalName: formState.technicalName.trim(),
      displayName: formState.displayName.trim(),
      language: formState.language,
      category: formState.category,
      body: formState.body.trim(),
      headerType: formState.headerType,
      variables: formState.variables,
      ...(formState.headerType === 'text' && formState.headerText.trim()
        ? { headerText: formState.headerText.trim() }
        : {}),
      ...(formState.headerHandle ? { headerHandle: formState.headerHandle } : {}),
      ...(formState.footer.trim() ? { footer: formState.footer.trim() } : {}),
    };

    if (editingTemplateId) {
      updateMutation.mutate({ id: editingTemplateId, payload });
      return;
    }

    createMutation.mutate(payload);
  }

  const previewContent = useMemo(
    () => renderTemplatePreview(formState.body, formState.variables),
    [formState.body, formState.variables],
  );

  const selectedSyncChannelName = channels.find((channel) => channel.id === syncChannelId)?.name ?? '';

  return (
    <PageShell>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--txt)', letterSpacing: '-0.4px' }}>
              {t('tenantAdmin.templates.title')}
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--txt-2)' }}>
              {t('tenantAdmin.templates.subtitle')}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setSyncOpen(true)}>
              {t('tenantAdmin.templates.sync')}
            </Button>
            <Button onClick={openCreateModal}>{t('tenantAdmin.templates.new')}</Button>
          </div>
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--txt-3)', fontSize: 13 }}>…</div>
        ) : templates.length === 0 ? (
          <div className="zd-empty-state" style={{ border: '1px dashed var(--line)', borderRadius: 'var(--r-lg)', padding: '34px 16px' }}>
            <div className="zd-empty-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M5 3.5h10A1.5 1.5 0 0 1 16.5 5v10A1.5 1.5 0 0 1 15 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5Z" stroke="currentColor" strokeWidth="1.4" />
                <path d="M6.5 7.5h7M6.5 10h7M6.5 12.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <strong style={{ color: 'var(--txt-2)', fontSize: 13 }}>{t('tenantAdmin.templates.empty')}</strong>
            <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>{t('tenantAdmin.templates.emptyHint')}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {channels.map((channel) => {
              const channelTemplates = templatesByChannel.get(channel.id) ?? [];
              if (channelTemplates.length === 0) return null;

              return (
                <section
                  key={channel.id}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-lg)',
                    background: 'var(--bg-2)',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                    <strong style={{ color: 'var(--txt)', fontSize: 13 }}>{channel.name}</strong>
                    <span style={{ color: 'var(--txt-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>{channelTemplates.length}</span>
                  </div>

                  <div style={{ display: 'grid', gap: 1 }}>
                    {channelTemplates.map((template) => {
                      const statusColors = templateStatusColors(template.status);
                      return (
                      <div
                        key={template.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) auto',
                          gap: 10,
                          padding: '12px 14px',
                          borderTop: '1px solid var(--line)',
                          background: 'var(--bg-2)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 13, color: 'var(--txt)' }}>{template.display_name}</strong>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)' }}>{template.name}</span>
                            <span style={{
                              borderRadius: 'var(--r-pill)',
                              border: '1px solid var(--line-2)',
                              background: 'var(--bg-3)',
                              color: 'var(--txt-2)',
                              padding: '1px 8px',
                              fontSize: 10,
                              fontWeight: 600,
                            }}>
                              {template.language}
                            </span>
                            <span style={{
                              borderRadius: 'var(--r-pill)',
                              border: '1px solid rgba(0,201,167,.24)',
                              background: 'var(--teal-dim)',
                              color: 'var(--teal)',
                              padding: '1px 8px',
                              fontSize: 10,
                              fontWeight: 600,
                            }}>
                              {t(`tenantAdmin.templates.category.${template.category}`)}
                            </span>
                            <span style={{
                              borderRadius: 'var(--r-pill)',
                              border: '1px solid var(--line-2)',
                              background: statusColors.background,
                              color: statusColors.color,
                              padding: '1px 8px',
                              fontSize: 10,
                              fontWeight: 600,
                            }}>
                              {t(`tenantAdmin.templates.status.${template.status}`)}
                            </span>
                          </div>

                          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--txt-2)', whiteSpace: 'pre-wrap' }}>
                            {template.body}
                          </p>
                        </div>

                        <div style={{ display: 'flex', gap: 6, alignSelf: 'start' }}>
                          <Button size="sm" variant="secondary" onClick={() => openEditModal(template)}>
                            {t('tenantAdmin.common.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTemplateId(template.id)}>
                            {t('tenantAdmin.common.remove')}
                          </Button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={closeFormModal}
        title={editingTemplateId ? t('tenantAdmin.templates.editTitle') : t('tenantAdmin.templates.newTitle')}
        maxWidth="lg"
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.selectChannel')}</label>
              <select
                value={formState.channelId}
                disabled={isMetaManagedTemplate}
                onChange={(event) => {
                  if (formState.headerHandle || selectedHeaderFile) clearHeaderMedia();
                  setFormState((current) => ({ ...current, channelId: event.target.value }));
                }}
                style={{ width: '100%', height: 40, borderRadius: 'var(--r)', border: `1px solid ${formErrors.channelId ? 'var(--red)' : 'var(--line-2)'}`, background: 'var(--bg-3)', color: 'var(--txt)', padding: '0 10px', fontFamily: 'var(--font)', fontSize: 13 }}
              >
                <option value="">{t('tenantAdmin.templates.selectChannel')}</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channel.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.language')}</label>
              <select
                value={formState.language}
                disabled={isMetaManagedTemplate}
                onChange={(event) => setFormState((current) => ({ ...current, language: event.target.value as WhatsAppTemplateLanguage }))}
                style={{ width: '100%', height: 40, borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt)', padding: '0 10px', fontFamily: 'var(--font)', fontSize: 13 }}
              >
                <option value="pt_BR">pt_BR</option>
                <option value="en_US">en_US</option>
                <option value="es">es</option>
              </select>
            </div>
          </div>

          <Input
            label={t('tenantAdmin.templates.technicalName')}
            value={formState.technicalName}
            disabled={isMetaManagedTemplate}
            onChange={(event) => {
              const nextValue = event.target.value;
              setFormState((current) => ({ ...current, technicalName: nextValue }));
            }}
            hint={t('tenantAdmin.templates.technicalNameHint')}
            error={formErrors.technicalName}
          />

          <Input
            label={t('tenantAdmin.templates.displayName')}
            value={formState.displayName}
            onChange={(event) => setFormState((current) => ({ ...current, displayName: event.target.value }))}
            error={formErrors.displayName}
          />

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.categoryLabel')}</label>
              <select
                value={formState.category}
                disabled={isMetaManagedTemplate}
                onChange={(event) => setFormState((current) => ({ ...current, category: event.target.value as WhatsAppTemplateCategory }))}
                style={{ width: '100%', height: 40, borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt)', padding: '0 10px', fontFamily: 'var(--font)', fontSize: 13 }}
              >
                <option value="MARKETING">{t('tenantAdmin.templates.category.MARKETING')}</option>
                <option value="UTILITY">{t('tenantAdmin.templates.category.UTILITY')}</option>
                {editingTemplate && (
                  <option value="AUTHENTICATION">{t('tenantAdmin.templates.category.AUTHENTICATION')}</option>
                )}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.statusLabel')}</label>
              <div
                style={{
                  minHeight: 40,
                  borderRadius: 'var(--r)',
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-3)',
                  color: editingTemplate
                    ? templateStatusColors(editingTemplate.status).color
                    : 'var(--amber)',
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {editingTemplate
                  ? t(`tenantAdmin.templates.status.${editingTemplate.status}`)
                  : t('tenantAdmin.templates.pendingReview')}
              </div>
              <span style={{ display: 'block', marginTop: 4, color: 'var(--txt-3)', fontSize: 10 }}>
                {t('tenantAdmin.templates.statusManagedHint')}
              </span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.body')}</label>
            <textarea
              value={formState.body}
              disabled={isMetaManagedTemplate}
              onChange={(event) => handleBodyChange(event.target.value)}
              rows={5}
              maxLength={1024}
              style={{ width: '100%', borderRadius: 'var(--r)', border: `1px solid ${formErrors.body ? 'var(--red)' : 'var(--line-2)'}`, background: 'var(--bg-3)', color: 'var(--txt)', padding: '10px 12px', fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--txt-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {renderBodyWithHighlights(formState.body)}
            </div>
            <span style={{ display: 'block', marginTop: 4, color: formErrors.body ? 'var(--red)' : 'var(--txt-3)', fontSize: 10 }}>
              {formErrors.body ?? t('tenantAdmin.templates.bodyVariablesHint')}
            </span>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>
                {t('tenantAdmin.templates.headerType.label')}
              </label>
              <select
                value={formState.headerType}
                disabled={isMetaManagedTemplate}
                onChange={(event) => handleHeaderTypeChange(event.target.value as WhatsAppTemplateInputHeaderType)}
                style={{
                  width: '100%',
                  height: 40,
                  borderRadius: 'var(--r)',
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-3)',
                  color: 'var(--txt)',
                  padding: '0 10px',
                  fontFamily: 'var(--font)',
                  fontSize: 13,
                }}
              >
                <option value="none">{t('tenantAdmin.templates.headerType.none')}</option>
                <option value="text">{t('tenantAdmin.templates.headerType.text')}</option>
                <option value="image">{t('tenantAdmin.templates.headerType.image')}</option>
                <option value="video">{t('tenantAdmin.templates.headerType.video')}</option>
                <option value="document">{t('tenantAdmin.templates.headerType.document')}</option>
              </select>
            </div>

            {formState.headerType === 'text' && (
              <Input
                label={t('tenantAdmin.templates.header')}
                value={formState.headerText}
                disabled={isMetaManagedTemplate}
                maxLength={60}
                onChange={(event) => setFormState((current) => ({ ...current, headerText: event.target.value }))}
                error={formErrors.header}
              />
            )}

            {(formState.headerType === 'image'
              || formState.headerType === 'video'
              || formState.headerType === 'document') && (
              <div>
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept={MEDIA_RULES[formState.headerType].accept}
                  disabled={isMetaManagedTemplate || mediaUploadMutation.isPending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadHeaderFile(file);
                  }}
                  style={{ display: 'none' }}
                />

                <div
                  className={`template-media-upload${formErrors.headerMedia ? ' is-error' : ''}`}
                  style={{
                    padding: 12,
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  {formState.headerPreviewUrl ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {formState.headerType === 'image' && (
                        <img
                          src={formState.headerPreviewUrl}
                          alt={formState.headerFilename || t('tenantAdmin.templates.headerType.image')}
                          style={{
                            width: '100%',
                            maxHeight: 180,
                            objectFit: 'contain',
                            borderRadius: 'var(--r)',
                            background: 'var(--bg-2)',
                          }}
                        />
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {(formState.headerType === 'video' || formState.headerType === 'document') && (
                          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden style={{ flex: '0 0 auto', color: 'var(--txt-2)' }}>
                            {formState.headerType === 'video' ? (
                              <>
                                <rect x="3" y="4.5" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
                                <path d="m8.5 8 4 2-4 2V8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                              </>
                            ) : (
                              <>
                                <path d="M5 2.75h6l4 4V17.25H5V2.75Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                                <path d="M11 2.75v4h4M7.5 10h5M7.5 12.75h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                              </>
                            )}
                          </svg>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ color: 'var(--txt)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formState.headerFilename || t(`tenantAdmin.templates.headerType.${formState.headerType}`)}
                          </div>
                          <div style={{ color: 'var(--txt-3)', fontSize: 10, marginTop: 2 }}>
                            {mediaUploadMutation.isPending
                              ? t('tenantAdmin.templates.upload.loading')
                              : formState.headerHandle
                                ? t('tenantAdmin.templates.upload.success')
                                : t('tenantAdmin.templates.upload.error')}
                          </div>
                        </div>
                        {!isMetaManagedTemplate && (
                          <button
                            type="button"
                            onClick={clearHeaderMedia}
                            title={t('tenantAdmin.templates.upload.remove')}
                            aria-label={t('tenantAdmin.templates.upload.remove')}
                            disabled={mediaUploadMutation.isPending}
                            style={{
                              width: 32,
                              height: 32,
                              display: 'grid',
                              placeItems: 'center',
                              borderRadius: 'var(--r)',
                              border: '1px solid var(--line-2)',
                              background: 'var(--bg-4)',
                              color: 'var(--txt-2)',
                              cursor: mediaUploadMutation.isPending ? 'wait' : 'pointer',
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: 'var(--txt-2)', fontSize: 12 }}>
                          {t(`tenantAdmin.templates.headerType.${formState.headerType}`)}
                        </div>
                        <div style={{ color: 'var(--txt-3)', fontSize: 10, marginTop: 2 }}>
                          {t(`tenantAdmin.templates.upload.${
                            formState.headerType === 'image'
                              ? 'limitImage'
                              : formState.headerType === 'video'
                                ? 'limitVideo'
                                : 'limitDocument'
                          }`)}
                        </div>
                      </div>
                      {!isMetaManagedTemplate && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => mediaInputRef.current?.click()}
                        >
                          {t('tenantAdmin.templates.upload.button')}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {formErrors.headerMedia && (
                  <span style={{ display: 'block', marginTop: 4, color: 'var(--red)', fontSize: 10 }}>
                    {formErrors.headerMedia}
                  </span>
                )}
                {selectedHeaderFile && !formState.headerHandle && !mediaUploadMutation.isPending && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => uploadHeaderFile(selectedHeaderFile)}
                    style={{ marginTop: 8 }}
                  >
                    {t('tenantAdmin.templates.upload.retry')}
                  </Button>
                )}
              </div>
            )}
          </div>

          <Input
            label={t('tenantAdmin.templates.footer')}
            value={formState.footer}
            disabled={isMetaManagedTemplate}
            maxLength={60}
            onChange={(event) => setFormState((current) => ({ ...current, footer: event.target.value }))}
            error={formErrors.footer}
          />

          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.variables')}</label>
            {formState.variables.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>—</div>
            ) : (
              formState.variables.map((variable) => (
                <Input
                  key={variable.index}
                  label={t('tenantAdmin.templates.variableExample', { index: variable.index })}
                  value={variable.example}
                  disabled={isMetaManagedTemplate}
                  onChange={(event) => handleVariableExampleChange(variable.index, event.target.value)}
                  error={formErrors[`variable.${variable.index}`]}
                />
              ))
            )}
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--bg-3)', padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6 }}>{t('tenantAdmin.templates.preview')}</div>
            {formState.headerType === 'text' && formState.headerText && (
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>
                {formState.headerText}
              </div>
            )}
            {formState.headerType === 'image' && formState.headerPreviewUrl && (
              <img
                src={formState.headerPreviewUrl}
                alt=""
                style={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 'var(--r)', marginBottom: 8 }}
              />
            )}
            {(formState.headerType === 'video' || formState.headerType === 'document') && formState.headerFilename && (
              <div style={{ fontSize: 12, color: 'var(--txt-2)', marginBottom: 8 }}>
                {formState.headerFilename}
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--txt)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {previewContent || '—'}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" onClick={closeFormModal}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <Button
              loading={createMutation.isPending || updateMutation.isPending || mediaUploadMutation.isPending}
              disabled={mediaUploadMutation.isPending}
              onClick={handleSubmit}
            >
              {editingTemplateId && isMetaManagedTemplate
                ? t('tenantAdmin.common.save')
                : t('tenantAdmin.templates.submitForReview')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        title={t('tenantAdmin.templates.sync')}
        maxWidth="sm"
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.selectChannel')}</label>
            <select
              value={syncChannelId}
              onChange={(event) => setSyncChannelId(event.target.value)}
              style={{ width: '100%', height: 40, borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt)', padding: '0 10px', fontFamily: 'var(--font)', fontSize: 13 }}
            >
              <option value="">{t('tenantAdmin.templates.selectChannel')}</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
          </div>

          {selectedSyncChannelName && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--txt-3)' }}>
              {selectedSyncChannelName}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" onClick={() => setSyncOpen(false)}>{t('tenantAdmin.common.cancel')}</Button>
            <Button
              loading={syncMutation.isPending}
              disabled={!syncChannelId}
              onClick={() => syncMutation.mutate(syncChannelId)}
            >
              {t('tenantAdmin.templates.sync')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={deleteTemplateId !== null}
        title={t('tenantAdmin.templates.deleteTitle')}
        message={t('tenantAdmin.templates.deleteConfirm')}
        confirmLabel={t('tenantAdmin.common.remove')}
        confirmVariant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTemplateId) {
            deleteMutation.mutate(deleteTemplateId);
          }
        }}
        onCancel={() => setDeleteTemplateId(null)}
      />
    </PageShell>
  );
}
