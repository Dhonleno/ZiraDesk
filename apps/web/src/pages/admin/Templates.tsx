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
const PAGE_SIZE = 12;

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
  if (status === 'rejected' || status === 'pending_deletion') {
    return { background: 'var(--red-dim)', color: 'var(--red)' };
  }
  if (status === 'in_appeal') {
    return { background: 'var(--blue-dim)', color: 'var(--blue)' };
  }
  if (status === 'disabled') {
    return { background: 'var(--bg-4)', color: 'var(--txt-3)' };
  }
  return { background: 'var(--amber-dim)', color: 'var(--amber)' };
}

function templateCategoryColors(category: WhatsAppTemplateCategory): { background: string; color: string } {
  if (category === 'UTILITY') {
    return { background: 'var(--blue-dim)', color: 'var(--blue)' };
  }
  if (category === 'AUTHENTICATION') {
    return { background: 'var(--purple-dim)', color: 'var(--purple)' };
  }
  return { background: 'var(--pink-dim)', color: 'var(--pink)' };
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

function formatRelativeSync(value: string | null, language: string, neverLabel: string): string {
  if (!value) return neverLabel;

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return neverLabel;

  const diffMs = Date.now() - timestamp;
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60_000));
  const prefix = language.startsWith('en') ? '' : language.startsWith('es') ? 'hace ' : 'há ';
  const suffix = language.startsWith('en') ? ' ago' : '';

  if (absMinutes < 60) return `${prefix}${absMinutes}min${suffix}`;

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return `${prefix}${absHours}h${suffix}`;

  const absDays = Math.round(absHours / 24);
  return `${prefix}${absDays}d${suffix}`;
}

export function Templates() {
  const { t, i18n } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<TemplateFormState>(DEFAULT_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [activeChannelId, setActiveChannelId] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
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
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? channels[0] ?? null,
    [activeChannelId, channels],
  );
  const activeChannelTemplates = useMemo(
    () => (activeChannel ? templatesByChannel.get(activeChannel.id) ?? [] : []),
    [activeChannel, templatesByChannel],
  );
  const totalPages = Math.max(1, Math.ceil(activeChannelTemplates.length / PAGE_SIZE));
  const pagedTemplates = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return activeChannelTemplates.slice(start, start + PAGE_SIZE);
  }, [activeChannelTemplates, currentPage]);
  const editingTemplate = useMemo(
    () => templates.find((template) => template.id === editingTemplateId) ?? null,
    [editingTemplateId, templates],
  );
  const isMetaManagedTemplate = Boolean(editingTemplate?.meta_template_id);

  useEffect(() => {
    if (channels.length === 0) {
      setActiveChannelId('');
      return;
    }
    if (!activeChannelId || !channels.some((channel) => channel.id === activeChannelId)) {
      setActiveChannelId(channels[0]!.id);
    }
  }, [activeChannelId, channels]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeChannelId]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

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
      <style>
        {`
          .templates-page {
            height: 100%;
            min-height: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .templates-page-head {
            padding: 0 0 12px;
            display: flex;
            align-items: flex-start;
            gap: 14px;
            border-bottom: 1px solid var(--line);
            flex-shrink: 0;
          }

          .templates-page-head h1 {
            margin: 0;
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.4px;
            color: var(--txt);
          }

          .templates-page-head p {
            margin: 4px 0 0;
            font-size: 13px;
            color: var(--txt-2);
          }

          .templates-page-actions {
            margin-left: auto;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }

          .templates-seg-tabs {
            display: flex;
            gap: 2px;
            border-bottom: 1px solid var(--line);
            overflow-x: auto;
            scrollbar-width: none;
            flex-shrink: 0;
          }

          .templates-seg-tabs::-webkit-scrollbar {
            display: none;
          }

          .templates-seg-tab {
            border: 0;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            background: transparent;
            color: var(--txt-2);
            padding: 10px 14px;
            font-family: var(--font);
            font-size: 12px;
            font-weight: 500;
            white-space: nowrap;
            cursor: pointer;
            transition: color 0.15s, border-color 0.15s;
          }

          .templates-seg-tab:hover {
            color: var(--txt);
          }

          .templates-seg-tab.active {
            color: var(--teal);
            border-bottom-color: var(--teal);
          }

          .templates-table-wrap {
            min-height: 260px;
            flex: 1;
            overflow-x: auto;
            overflow-y: auto;
            border-bottom: 1px solid var(--line);
          }

          .templates-table {
            width: 100%;
            min-width: 900px;
            border-collapse: collapse;
            table-layout: fixed;
          }

          .templates-table thead th {
            position: sticky;
            top: 0;
            z-index: 1;
            background: var(--bg-2);
            border-bottom: 1px solid var(--line);
            padding: 10px 14px;
            color: var(--txt-3);
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            text-align: left;
            white-space: nowrap;
          }

          .templates-table tbody tr {
            height: 44px;
            border-bottom: 1px solid var(--line);
            transition: background 0.12s;
          }

          .templates-table tbody tr:hover {
            background: var(--bg-3);
          }

          .templates-table tbody td {
            padding: 10px 14px;
            vertical-align: middle;
          }

          .templates-col-name {
            width: auto;
            min-width: 200px;
          }

          .templates-col-language {
            width: 90px;
            text-align: center;
          }

          .templates-col-category {
            width: 110px;
          }

          .templates-col-status {
            width: 120px;
          }

          .templates-col-sync {
            width: 140px;
          }

          .templates-col-actions {
            width: 80px;
            text-align: center;
          }

          .templates-name-cell {
            min-width: 0;
            display: grid;
            gap: 2px;
          }

          .templates-name-line {
            min-width: 0;
            display: flex;
            align-items: baseline;
            gap: 8px;
          }

          .templates-display-name {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--txt);
            font-size: 13px;
            font-weight: 500;
          }

          .templates-technical-name,
          .templates-language-code,
          .templates-sync-time {
            font-family: var(--mono);
            color: var(--txt-3);
          }

          .templates-technical-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 11px;
          }

          .templates-body-preview {
            max-width: 320px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--txt-2);
            font-size: 12px;
          }

          .templates-language-code {
            font-size: 12px;
          }

          .templates-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 3px 8px;
            border-radius: var(--r-pill);
            font-size: 11px;
            font-weight: 500;
            white-space: nowrap;
          }

          .templates-sync-time {
            font-size: 11px;
          }

          .templates-row-actions {
            display: inline-flex;
            justify-content: center;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.12s;
          }

          .templates-table tbody tr:hover .templates-row-actions {
            opacity: 1;
          }

          .templates-row-action-btn {
            width: 28px;
            height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            border: 1px solid var(--line);
            background: var(--bg-3);
            color: var(--txt-3);
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s, color 0.15s;
          }

          .templates-row-action-btn:hover {
            background: var(--bg-4);
            border-color: var(--line-2);
            color: var(--txt);
          }

          .templates-row-action-btn.danger:hover {
            color: var(--red);
          }

          .templates-empty {
            min-height: 280px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            text-align: center;
          }

          .templates-empty-icon {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--blue-dim);
            border: 1px solid var(--line-2);
            color: var(--blue);
          }

          .templates-empty strong {
            color: var(--txt-2);
            font-size: 13px;
            font-weight: 500;
          }

          .templates-empty span {
            color: var(--txt-3);
            font-size: 11px;
          }

          .templates-tbl-foot {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 10px 0 0;
            flex-shrink: 0;
            color: var(--txt-3);
            font-size: 12px;
          }

          .templates-tbl-foot strong {
            color: var(--txt);
            font-family: var(--mono);
            font-weight: 500;
          }

          .templates-pagi {
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .templates-pagi-btn {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            border: 1px solid var(--line);
            background: var(--bg-3);
            color: var(--txt-2);
            font-family: var(--mono);
            font-size: 11px;
            cursor: pointer;
          }

          .templates-pagi-btn:hover {
            background: var(--bg-4);
            color: var(--txt);
          }

          .templates-pagi-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
          }

          .templates-pagi-btn.active {
            background: var(--teal);
            border-color: var(--teal);
            color: var(--on-teal);
            font-weight: 600;
          }
        `}
      </style>

      <div className="templates-page">
        <div className="templates-page-head">
          <div>
            <h1>
              {t('tenantAdmin.templates.title')}
            </h1>
            <p>
              {t('tenantAdmin.templates.subtitle')}
            </p>
          </div>

          <div className="templates-page-actions">
            <Button variant="secondary" onClick={() => setSyncOpen(true)}>
              {t('tenantAdmin.templates.sync')}
            </Button>
            <Button onClick={openCreateModal}>{t('tenantAdmin.templates.new')}</Button>
          </div>
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--txt-3)', fontSize: 13, padding: '16px 0' }}>…</div>
        ) : (
          <>
            <div className="templates-seg-tabs" role="tablist" aria-label={t('tenantAdmin.templates.selectChannel')}>
              {channels.map((channel) => {
                const count = templatesByChannel.get(channel.id)?.length ?? 0;
                const active = activeChannel?.id === channel.id;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`templates-seg-tab${active ? ' active' : ''}`}
                    onClick={() => setActiveChannelId(channel.id)}
                  >
                    {channel.name} <span style={{ fontFamily: 'var(--mono)' }}>({count})</span>
                  </button>
                );
              })}
            </div>

            {activeChannelTemplates.length === 0 ? (
              <div className="templates-empty">
                <div className="templates-empty-icon" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
                    <path d="M6 3.5h6.5L16 7v11.5H6V3.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M12.5 3.5V7H16M8.5 11h5M11 8.75v4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <strong>
                  {t('tenantAdmin.templates.empty.title')}
                </strong>
                <span>
                  {t('tenantAdmin.templates.empty.subtitle')}
                </span>
                <Button size="sm" onClick={openCreateModal}>
                  {t('tenantAdmin.templates.new')}
                </Button>
              </div>
            ) : (
              <>
                <div className="templates-table-wrap">
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th className="templates-col-name">{t('tenantAdmin.templates.table.name')}</th>
                        <th className="templates-col-language">{t('tenantAdmin.templates.table.language')}</th>
                        <th className="templates-col-category">{t('tenantAdmin.templates.table.category')}</th>
                        <th className="templates-col-status">{t('tenantAdmin.templates.table.status')}</th>
                        <th className="templates-col-sync">{t('tenantAdmin.templates.table.lastSync')}</th>
                        <th className="templates-col-actions">{t('tenantAdmin.templates.table.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedTemplates.map((template) => {
                        const categoryColors = templateCategoryColors(template.category);
                      const statusColors = templateStatusColors(template.status);
                      return (
                          <tr key={template.id}>
                            <td className="templates-col-name">
                              <div className="templates-name-cell">
                                <div className="templates-name-line">
                                  <span className="templates-display-name">{template.display_name}</span>
                                  <span className="templates-technical-name">{template.name}</span>
                                </div>
                                <div className="templates-body-preview">{template.body || '—'}</div>
                              </div>
                            </td>
                            <td className="templates-col-language">
                              <span className="templates-language-code">{template.language}</span>
                            </td>
                            <td className="templates-col-category">
                              <span
                                className="templates-pill"
                                style={{ background: categoryColors.background, color: categoryColors.color }}
                              >
                                {t(`tenantAdmin.templates.category.${template.category}`)}
                              </span>
                            </td>
                            <td className="templates-col-status">
                              <span
                                className="templates-pill"
                                style={{ background: statusColors.background, color: statusColors.color }}
                              >
                                {t(`tenantAdmin.templates.status.${template.status}`)}
                              </span>
                            </td>
                            <td className="templates-col-sync">
                              <span className="templates-sync-time">
                                {formatRelativeSync(
                                  template.last_synced_at,
                                  i18n.language,
                                  t('tenantAdmin.templates.syncNever', { defaultValue: 'nunca' }),
                                )}
                              </span>
                            </td>
                            <td className="templates-col-actions">
                              <div className="templates-row-actions">
                                <button
                                  type="button"
                                  className="templates-row-action-btn"
                                  title={t('tenantAdmin.common.edit')}
                                  aria-label={t('tenantAdmin.common.edit')}
                                  onClick={() => openEditModal(template)}
                                >
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                                    <path d="M3 11.75 4.1 9.1l6.4-6.4 2.8 2.8-6.4 6.4L4.25 13H3v-1.25Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="templates-row-action-btn danger"
                                  title={t('tenantAdmin.common.remove')}
                                  aria-label={t('tenantAdmin.common.remove')}
                                  onClick={() => setDeleteTemplateId(template.id)}
                                >
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                                    <path d="M3 4.5h10M6.25 4.5V3.25h3.5V4.5M5 6.5v6h6v-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                      );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="templates-tbl-foot">
                  <span>
                    {t('tenantAdmin.templates.table.showing', {
                      defaultValue: 'Mostrando',
                    })}{' '}
                    <strong>{(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, activeChannelTemplates.length)}</strong>
                    {' '}
                    {t('tenantAdmin.templates.table.of', { defaultValue: 'de' })}
                    {' '}
                    <strong>{activeChannelTemplates.length}</strong>
                  </span>
                  {totalPages > 1 && (
                    <div className="templates-pagi">
                      <button
                        type="button"
                        className="templates-pagi-btn"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                        aria-label={t('tenantAdmin.common.previous', { defaultValue: 'Anterior' })}
                      >
                        ‹
                      </button>
                      {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                        <button
                          key={page}
                          type="button"
                          className={`templates-pagi-btn${page === currentPage ? ' active' : ''}`}
                          onClick={() => setCurrentPage(page)}
                          aria-label={`${t('tenantAdmin.templates.table.page', { defaultValue: 'Página' })} ${page}`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="templates-pagi-btn"
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                        aria-label={t('tenantAdmin.common.next', { defaultValue: 'Próxima' })}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
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
