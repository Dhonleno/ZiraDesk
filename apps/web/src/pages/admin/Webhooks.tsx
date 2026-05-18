import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type OutboundWebhook, type WebhookEvent, type CreateWebhookPayload } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { PageShell } from '../../components/layout/PageShell';
import { useToast } from '../../stores/toast.store';

interface WebhookFormState {
  name: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  headers: Array<{ key: string; value: string }>;
  isActive: boolean;
}

const EMPTY_FORM: WebhookFormState = {
  name: '',
  url: '',
  secret: '',
  events: [],
  headers: [],
  isActive: true,
};

const EVENT_GROUPS: Array<{ groupKey: string; events: WebhookEvent[] }> = [
  {
    groupKey: 'tickets',
    events: ['ticket.created', 'ticket.updated', 'ticket.resolved', 'ticket.closed'],
  },
  {
    groupKey: 'conversations',
    events: ['conversation.created', 'conversation.resolved', 'conversation.assigned'],
  },
  {
    groupKey: 'crm',
    events: ['contact.created', 'contact.updated'],
  },
];

function statusColor(status: number | null): string {
  if (status === null) return 'var(--txt-3)';
  if (status >= 200 && status < 300) return 'var(--green)';
  return 'var(--red)';
}

function headersToForm(headers: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}

function formToHeaders(pairs: Array<{ key: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const k = key.trim();
    if (k) result[k] = value;
  }
  return result;
}

function formToPayload(form: WebhookFormState): CreateWebhookPayload {
  const trimmedSecret = form.secret.trim();
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    ...(trimmedSecret ? { secret: trimmedSecret } : {}),
    events: form.events,
    headers: formToHeaders(form.headers),
    isActive: form.isActive,
  };
}

export function Webhooks() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WebhookFormState>(EMPTY_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'webhooks'],
    queryFn: () => adminApi.webhooks.list(),
  });

  const webhooks = data ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof formToPayload>) => adminApi.webhooks.create(payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.webhooks.createSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
      setModalOpen(false);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReturnType<typeof formToPayload> }) =>
      adminApi.webhooks.update(id, payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.webhooks.updateSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
      setModalOpen(false);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.webhooks.delete(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.webhooks.deleteSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
      setDeleteId(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  function openNew() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, events: [], headers: [], url: '' });
    setShowSecret(false);
    setModalOpen(true);
  }

  function openEdit(webhook: OutboundWebhook) {
    setEditingId(webhook.id);
    setForm({
      name: webhook.name,
      url: webhook.url,
      secret: webhook.secret ?? '',
      events: webhook.events,
      headers: headersToForm(webhook.headers),
      isActive: webhook.is_active,
    });
    setShowSecret(false);
    setModalOpen(true);
  }

  function handleSubmit() {
    const payload = formToPayload(form);
    if (!payload.name || !payload.url) {
      toast.error(t('tenantAdmin.common.errorSave'));
      return;
    }
    if (payload.events.length === 0) {
      toast.error(t('tenantAdmin.common.errorSave'));
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const result = await adminApi.webhooks.test(id);
      const status = result.data?.status ?? 0;
      if (status >= 200 && status < 300) {
        toast.success(t('tenantAdmin.webhooks.testSuccess', { status }));
      } else {
        toast.error(t('tenantAdmin.webhooks.testError', { status }));
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
    } catch {
      toast.error(t('tenantAdmin.webhooks.testError', { status: 0 }));
    } finally {
      setTestingId(null);
    }
  }

  function toggleEvent(event: WebhookEvent) {
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  }

  function addHeader() {
    setForm((prev) => ({ ...prev, headers: [...prev.headers, { key: '', value: '' }] }));
  }

  function removeHeader(index: number) {
    setForm((prev) => ({ ...prev, headers: prev.headers.filter((_, i) => i !== index) }));
  }

  function updateHeader(index: number, field: 'key' | 'value', value: string) {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    }));
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <PageShell>
      <div style={{ maxWidth: 800 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--txt)' }}>
              {t('tenantAdmin.webhooks.title')}
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--txt-2)' }}>
              {t('tenantAdmin.webhooks.subtitle')}
            </p>
          </div>
          <Button onClick={openNew}>
            + {t('tenantAdmin.webhooks.new')}
          </Button>
        </div>

        {isLoading ? (
          <p style={{ color: 'var(--txt-3)', fontSize: 13 }}>…</p>
        ) : webhooks.length === 0 ? (
          <div style={{
            border: '1px dashed var(--line)',
            borderRadius: 'var(--r)',
            padding: '40px 24px',
            textAlign: 'center',
            color: 'var(--txt-3)',
            fontSize: 13,
          }}>
            {t('tenantAdmin.webhooks.empty')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(webhooks as OutboundWebhook[]).map((webhook) => (
              <div
                key={webhook.id}
                style={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r)',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--txt)' }}>
                      {webhook.name}
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 7px',
                      borderRadius: 999,
                      background: webhook.is_active ? 'var(--teal-dim)' : 'var(--bg-3)',
                      color: webhook.is_active ? 'var(--teal)' : 'var(--txt-3)',
                    }}>
                      {webhook.is_active ? t('tenantAdmin.webhooks.active') : t('tenantAdmin.webhooks.inactive')}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {webhook.url}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {webhook.events.map((ev) => (
                      <span key={ev} style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'var(--bg-3)',
                        color: 'var(--txt-2)',
                        fontFamily: 'monospace',
                      }}>
                        {ev}
                      </span>
                    ))}
                  </div>
                  {webhook.last_triggered_at && (
                    <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 4 }}>
                      {t('tenantAdmin.webhooks.lastTriggered')}:{' '}
                      {new Date(webhook.last_triggered_at).toLocaleString()}{' '}
                      {webhook.last_status !== null && (
                        <span style={{ color: statusColor(webhook.last_status), fontWeight: 600 }}>
                          {webhook.last_status}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={testingId === webhook.id}
                    onClick={() => handleTest(webhook.id)}
                  >
                    {t('tenantAdmin.webhooks.test')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(webhook)}>
                    {t('tenantAdmin.common.edit')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteId(webhook.id)}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M2 3.5h10M5.5 3.5V2.5h3v1M3 3.5l.7 8h6.6l.7-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? t('tenantAdmin.webhooks.editTitle') : t('tenantAdmin.webhooks.newTitle')}
        maxWidth="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            label={t('tenantAdmin.webhooks.name')}
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Meu webhook"
          />

          <Input
            label={t('tenantAdmin.webhooks.url')}
            value={form.url}
            onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
            placeholder="https://example.com/webhook"
          />

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--txt-2)', marginBottom: 6 }}>
              {t('tenantAdmin.webhooks.secret')}
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showSecret ? 'text' : 'password'}
                value={form.secret}
                onChange={(e) => setForm((p) => ({ ...p, secret: e.target.value }))}
                placeholder={t('tenantAdmin.webhooks.secretHint')}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  fontSize: 13,
                  borderRadius: 'var(--r)',
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  color: 'var(--txt)',
                  outline: 'none',
                }}
              />
              <Button variant="ghost" size="sm" type="button" onClick={() => setShowSecret((v) => !v)}>
                {showSecret ? '🙈' : '👁'}
              </Button>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--txt-2)', marginBottom: 10 }}>
              {t('tenantAdmin.webhooks.events')}
            </label>
            {EVENT_GROUPS.map((group) => (
              <div key={group.groupKey} style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--txt-3)' }}>
                  {t(`tenantAdmin.webhooks.groups.${group.groupKey}`)}
                </p>
                {group.events.map((ev) => (
                  <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                    <span style={{ fontSize: 13, color: 'var(--txt)' }}>
                      {t(`tenantAdmin.webhooks.eventLabels.${ev}`)}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--txt-2)' }}>
                {t('tenantAdmin.webhooks.headers')}
              </label>
              <Button variant="ghost" size="sm" type="button" onClick={addHeader}>
                {t('tenantAdmin.webhooks.addHeader')}
              </Button>
            </div>
            {form.headers.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  placeholder="Header"
                  value={h.key}
                  onChange={(e) => updateHeader(i, 'key', e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: 12,
                    borderRadius: 'var(--r)',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--txt)',
                    outline: 'none',
                  }}
                />
                <input
                  placeholder="Value"
                  value={h.value}
                  onChange={(e) => updateHeader(i, 'value', e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: 12,
                    borderRadius: 'var(--r)',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--txt)',
                    outline: 'none',
                  }}
                />
                <Button variant="ghost" size="sm" type="button" onClick={() => removeHeader(i)}>
                  ×
                </Button>
              </div>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
            />
            <span style={{ fontSize: 13, color: 'var(--txt)' }}>
              {t('tenantAdmin.webhooks.active')}
            </span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <Button loading={isSubmitting} onClick={handleSubmit}>
              {t('tenantAdmin.common.save')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={deleteId !== null}
        title={t('tenantAdmin.webhooks.deleteTitle')}
        message={t('tenantAdmin.webhooks.deleteConfirm')}
        confirmLabel={t('tenantAdmin.common.remove')}
        confirmVariant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
        onCancel={() => setDeleteId(null)}
      />
    </PageShell>
  );
}
