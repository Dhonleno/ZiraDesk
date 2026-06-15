import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { PageShell } from '../../components/layout/PageShell';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useTenant } from '../../hooks/useTenant';

interface RedmineFormState {
  redmineUrl: string;
  apiKey: string;
  projectId: string;
  isActive: boolean;
  syncComments: boolean;
  syncStatus: boolean;
  statusMap: Record<string, number>;
}

const DEFAULT_STATUS_MAP: Record<string, number> = {
  open: 1,
  in_progress: 2,
  waiting: 4,
  resolved: 3,
  closed: 5,
};

const DEFAULT_FORM: RedmineFormState = {
  redmineUrl: '',
  apiKey: '',
  projectId: '',
  isActive: true,
  syncComments: true,
  syncStatus: true,
  statusMap: DEFAULT_STATUS_MAP,
};

export function Integrations() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [form, setForm] = useState<RedmineFormState>(DEFAULT_FORM);
  const { data: tenant } = useTenant();

  const { data: integration } = useQuery({
    queryKey: ['admin', 'integrations', 'redmine'],
    queryFn: () => adminApi.integrations.redmine.get(),
  });

  useEffect(() => {
    if (!integration) {
      setForm(DEFAULT_FORM);
      return;
    }
    setForm({
      redmineUrl: integration.redmine_url ?? '',
      apiKey: integration.api_key_masked ?? '',
      projectId: integration.project_id ?? '',
      isActive: integration.is_active ?? true,
      syncComments: integration.sync_comments ?? true,
      syncStatus: integration.sync_status ?? true,
      statusMap: {
        ...DEFAULT_STATUS_MAP,
        ...(integration.status_map ?? {}),
      },
    });
  }, [integration]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: 'Redmine',
        redmineUrl: form.redmineUrl.trim(),
        projectId: form.projectId.trim(),
        isActive: form.isActive,
        syncComments: form.syncComments,
        syncStatus: form.syncStatus,
        statusMap: form.statusMap,
      };

      if (!integration) {
        return adminApi.integrations.redmine.save({
          ...payload,
          apiKey: form.apiKey.trim(),
        });
      }

      return adminApi.integrations.redmine.update({
        ...payload,
        ...(form.apiKey.trim() && form.apiKey !== '••••••••' ? { apiKey: form.apiKey.trim() } : {}),
      });
    },
    onSuccess: async () => {
      toast.success(t('tenantAdmin.integrations.redmine.saveSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'integrations', 'redmine'] });
      setModalOpen(false);
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (nextActive: boolean) => {
      if (!integration) throw new Error('missing_integration');
      return adminApi.integrations.redmine.update({ isActive: nextActive });
    },
    onSuccess: async () => {
      toast.success(t('tenantAdmin.integrations.redmine.saveSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'integrations', 'redmine'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const redmineUrl = form.redmineUrl.trim();
      const apiKey = form.apiKey.trim();

      if (redmineUrl && apiKey && apiKey !== '••••••••') {
        return adminApi.integrations.redmine.test({ redmineUrl, apiKey });
      }
      return adminApi.integrations.redmine.test();
    },
    onSuccess: () => toast.success(t('tenantAdmin.integrations.redmine.testSuccess')),
    onError: () => toast.error(t('tenantAdmin.integrations.redmine.testError')),
  });

  const webhookUrl = `https://api.ziradesk.com/webhooks/redmine/${tenant?.slug ?? 'tenant-slug'}`;

  const canSave =
    form.redmineUrl.trim().length > 0 &&
    form.projectId.trim().length > 0 &&
    (integration ? true : form.apiKey.trim().length > 0);
  const isIntegrationActive = integration?.is_active ?? false;
  const canToggleIntegration = Boolean(integration);

  return (
    <PageShell>
      <div style={{ maxWidth: 980 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--txt)' }}>
            {t('tenantAdmin.integrations.title')}
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--txt-2)', fontSize: 13 }}>
            {t('tenantAdmin.integrations.subtitle')}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isIntegrationActive ? 'var(--teal-dim)' : 'var(--red-dim)',
                color: isIntegrationActive ? 'var(--teal)' : 'var(--red)',
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </span>
              <strong style={{ color: 'var(--txt)', fontSize: 14 }}>
                {t('tenantAdmin.integrations.redmine.title')}
              </strong>
              </div>
              <button
                type="button"
                aria-label={
                  isIntegrationActive
                    ? t('tenantAdmin.common.deactivate')
                    : t('tenantAdmin.common.activate')
                }
                title={
                  isIntegrationActive
                    ? t('tenantAdmin.common.deactivate')
                    : t('tenantAdmin.common.activate')
                }
                onClick={() => {
                  if (!canToggleIntegration) {
                    setModalOpen(true);
                    return;
                  }
                  toggleActiveMutation.mutate(!isIntegrationActive);
                }}
                disabled={toggleActiveMutation.isPending}
                style={{
                  width: 'fit-content',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: isIntegrationActive ? 'var(--teal-dim)' : 'var(--bg-3)',
                  border: `1px solid ${isIntegrationActive ? 'rgba(0,201,167,.25)' : 'var(--line-2)'}`,
                  borderRadius: 'var(--r-pill)',
                  padding: '4px 8px',
                  cursor: canToggleIntegration ? 'pointer' : 'default',
                  color: isIntegrationActive ? 'var(--teal)' : 'var(--txt-2)',
                  opacity: canToggleIntegration ? 1 : 0.72,
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 16,
                    borderRadius: 999,
                    background: isIntegrationActive ? 'var(--teal)' : 'var(--bg-5)',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: isIntegrationActive ? 14 : 2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: isIntegrationActive ? 'var(--on-teal)' : 'var(--txt-3)',
                      transition: 'left .15s',
                    }}
                  />
                </span>
              </button>
            </div>
            <p style={{
              margin: '-4px 0 0',
              color: isIntegrationActive ? 'var(--teal)' : 'var(--txt-3)',
              fontSize: 11,
              fontWeight: 500,
            }}>
              {isIntegrationActive
                ? t('tenantAdmin.channels.status.active')
                : t('tenantAdmin.channels.status.inactive')}
            </p>
            <p style={{ margin: 0, color: 'var(--txt-2)', fontSize: 12 }}>
              {t('tenantAdmin.integrations.redmine.description')}
            </p>
            <div style={{ marginTop: 'auto' }}>
              <Button onClick={() => setModalOpen(true)}>
                {t('tenantAdmin.integrations.redmine.configure')}
              </Button>
            </div>
          </div>

          {['Jira', 'GitHub Issues', 'Linear'].map((name) => (
            <div key={name} style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--bg-2)',
              padding: 16,
              opacity: 0.72,
              display: 'grid',
              gap: 8,
            }}>
              <strong style={{ color: 'var(--txt)', fontSize: 14 }}>{name}</strong>
              <p style={{ margin: 0, color: 'var(--txt-3)', fontSize: 12 }}>
                {t('tenantAdmin.integrations.redmine.comingSoon')}
              </p>
            </div>
          ))}
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('tenantAdmin.integrations.redmine.title')}
        maxWidth="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input
            label={t('tenantAdmin.integrations.redmine.url')}
            value={form.redmineUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, redmineUrl: e.target.value }))}
            placeholder={t('tenantAdmin.integrations.redmine.urlHint')}
          />

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--txt-2)', marginBottom: 6 }}>
              {t('tenantAdmin.integrations.redmine.apiKey')}
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={t('tenantAdmin.integrations.redmine.apiKeyHint')}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 'var(--r)',
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  color: 'var(--txt)',
                  fontSize: 13,
                }}
              />
              <Button variant="ghost" size="sm" type="button" onClick={() => setShowApiKey((v) => !v)}>
                {showApiKey
                  ? t('tenantAdmin.integrations.hide')
                  : t('tenantAdmin.integrations.show')}
              </Button>
            </div>
          </div>

          <Input
            label={t('tenantAdmin.integrations.redmine.projectId')}
            value={form.projectId}
            onChange={(e) => setForm((prev) => ({ ...prev, projectId: e.target.value }))}
            placeholder={t('tenantAdmin.integrations.redmine.projectIdHint')}
          />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--txt)' }}>
            <input
              type="checkbox"
              checked={form.syncComments}
              onChange={(e) => setForm((prev) => ({ ...prev, syncComments: e.target.checked }))}
            />
            {t('tenantAdmin.integrations.redmine.syncComments')}
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--txt)' }}>
            <input
              type="checkbox"
              checked={form.syncStatus}
              onChange={(e) => setForm((prev) => ({ ...prev, syncStatus: e.target.checked }))}
            />
            {t('tenantAdmin.integrations.redmine.syncStatus')}
          </label>

          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--txt-2)', fontSize: 12 }}>
              {t('tenantAdmin.integrations.redmine.statusMap')}
            </summary>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {Object.entries(form.statusMap).map(([key, value]) => (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--txt-2)', fontSize: 12, fontFamily: 'var(--mono)' }}>{key}</span>
                  <input
                    type="number"
                    min={1}
                    value={value}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        statusMap: {
                          ...prev.statusMap,
                          [key]: Number(e.target.value || 0),
                        },
                      }))
                    }
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 'var(--r)',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--txt)',
                      fontSize: 12,
                    }}
                  />
                </div>
              ))}
            </div>
          </details>

          <div style={{ border: '1px dashed var(--line)', borderRadius: 'var(--r)', padding: 10 }}>
            <p style={{ margin: 0, color: 'var(--txt-2)', fontSize: 12, fontWeight: 600 }}>
              {t('tenantAdmin.integrations.redmine.webhookUrl')}
            </p>
            <p style={{ margin: '6px 0 0', color: 'var(--txt-3)', fontSize: 12, wordBreak: 'break-all', fontFamily: 'var(--mono)' }}>
              {webhookUrl}
            </p>
            <p style={{ margin: '8px 0 0', color: 'var(--txt-3)', fontSize: 11 }}>
              {t('tenantAdmin.integrations.redmine.webhookHint')}
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 4 }}>
            <Button
              variant="secondary"
              type="button"
              loading={testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              {t('tenantAdmin.integrations.redmine.testConnection')}
            </Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                {t('tenantAdmin.common.cancel')}
              </Button>
              <Button
                type="button"
                loading={saveMutation.isPending}
                disabled={!canSave}
                onClick={() => saveMutation.mutate()}
              >
                {t('tenantAdmin.common.save')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
