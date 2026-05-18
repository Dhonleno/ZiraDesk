import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  type CreateWhatsAppTemplatePayload,
  type WhatsAppTemplate,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateLanguage,
  type WhatsAppTemplateStatus,
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
  header: string;
  footer: string;
  variables: WhatsAppTemplateVariable[];
  status: WhatsAppTemplateStatus;
}

const TECHNICAL_NAME_REGEX = /^[a-z0-9_]+$/;

const DEFAULT_FORM: TemplateFormState = {
  channelId: '',
  technicalName: '',
  displayName: '',
  language: 'pt_BR',
  category: 'MARKETING',
  body: '',
  header: '',
  footer: '',
  variables: [],
  status: 'approved',
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

function templateToForm(template: WhatsAppTemplate): TemplateFormState {
  return {
    channelId: template.channel_id,
    technicalName: template.name,
    displayName: template.display_name,
    language: template.language,
    category: template.category,
    body: template.body,
    header: template.header ?? '',
    footer: template.footer ?? '',
    variables: Array.isArray(template.variables) ? template.variables : [],
    status: template.status,
  };
}

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

  const createMutation = useMutation({
    mutationFn: (payload: CreateWhatsAppTemplatePayload) => adminApi.templates.create(payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.templates.savedSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'templates'] });
      setFormOpen(false);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateWhatsAppTemplatePayload> }) =>
      adminApi.templates.update(id, payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.templates.savedSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'templates'] });
      setFormOpen(false);
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

  function openCreateModal() {
    setEditingTemplateId(null);
    setFormState({
      ...DEFAULT_FORM,
      channelId: channels[0]?.id ?? '',
    });
    setFormErrors({});
    setFormOpen(true);
  }

  function openEditModal(template: WhatsAppTemplate) {
    setEditingTemplateId(template.id);
    setFormState(templateToForm(template));
    setFormErrors({});
    setFormOpen(true);
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
    const validationErrors = validateForm(formState);
    setFormErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const payload: CreateWhatsAppTemplatePayload = {
      channelId: formState.channelId,
      technicalName: formState.technicalName.trim(),
      displayName: formState.displayName.trim(),
      language: formState.language,
      category: formState.category,
      body: formState.body.trim(),
      variables: formState.variables,
      status: formState.status,
      ...(formState.header.trim() ? { header: formState.header.trim() } : {}),
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
                    {channelTemplates.map((template) => (
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
                              background: template.status === 'approved' ? 'var(--green-dim)' : template.status === 'rejected' ? 'var(--red-dim)' : 'var(--amber-dim)',
                              color: template.status === 'approved' ? 'var(--green)' : template.status === 'rejected' ? 'var(--red)' : 'var(--amber)',
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
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingTemplateId ? t('tenantAdmin.templates.editTitle') : t('tenantAdmin.templates.newTitle')}
        maxWidth="lg"
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.selectChannel')}</label>
              <select
                value={formState.channelId}
                onChange={(event) => setFormState((current) => ({ ...current, channelId: event.target.value }))}
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
                onChange={(event) => setFormState((current) => ({ ...current, category: event.target.value as WhatsAppTemplateCategory }))}
                style={{ width: '100%', height: 40, borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt)', padding: '0 10px', fontFamily: 'var(--font)', fontSize: 13 }}
              >
                <option value="MARKETING">{t('tenantAdmin.templates.category.MARKETING')}</option>
                <option value="UTILITY">{t('tenantAdmin.templates.category.UTILITY')}</option>
                <option value="AUTHENTICATION">{t('tenantAdmin.templates.category.AUTHENTICATION')}</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.statusLabel')}</label>
              <select
                value={formState.status}
                onChange={(event) => setFormState((current) => ({ ...current, status: event.target.value as WhatsAppTemplateStatus }))}
                style={{ width: '100%', height: 40, borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt)', padding: '0 10px', fontFamily: 'var(--font)', fontSize: 13 }}
              >
                <option value="approved">{t('tenantAdmin.templates.status.approved')}</option>
                <option value="pending">{t('tenantAdmin.templates.status.pending')}</option>
                <option value="rejected">{t('tenantAdmin.templates.status.rejected')}</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.templates.body')}</label>
            <textarea
              value={formState.body}
              onChange={(event) => handleBodyChange(event.target.value)}
              rows={5}
              style={{ width: '100%', borderRadius: 'var(--r)', border: `1px solid ${formErrors.body ? 'var(--red)' : 'var(--line-2)'}`, background: 'var(--bg-3)', color: 'var(--txt)', padding: '10px 12px', fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--txt-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {renderBodyWithHighlights(formState.body)}
            </div>
          </div>

          <Input
            label={t('tenantAdmin.templates.header')}
            value={formState.header}
            onChange={(event) => setFormState((current) => ({ ...current, header: event.target.value }))}
          />

          <Input
            label={t('tenantAdmin.templates.footer')}
            value={formState.footer}
            onChange={(event) => setFormState((current) => ({ ...current, footer: event.target.value }))}
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
                  onChange={(event) => handleVariableExampleChange(variable.index, event.target.value)}
                />
              ))
            )}
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--bg-3)', padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 6 }}>{t('tenantAdmin.templates.preview')}</div>
            <div style={{ fontSize: 13, color: 'var(--txt)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {previewContent || '—'}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <Button
              loading={createMutation.isPending || updateMutation.isPending}
              onClick={handleSubmit}
            >
              {t('tenantAdmin.common.save')}
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
