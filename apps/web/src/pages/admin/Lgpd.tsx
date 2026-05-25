import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { adminApi, contactsApi, type CrmContact } from '../../services/api';
import { useToast } from '../../stores/toast.store';

type ConsentStatus = 'pending' | 'granted' | 'denied' | 'revoked';

function consentLabel(t: (key: string) => string, status: ConsentStatus): string {
  return t(`lgpd.consentStatus.${status}`);
}

function toSafeFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function downloadJsonFile(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function Lgpd() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [contactsPage, setContactsPage] = useState(1);
  const [selectedStatus, setSelectedStatus] = useState<Record<string, ConsentStatus>>({});
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState(180);

  const contactsQuery = useQuery({
    queryKey: ['admin', 'lgpd', 'contacts', search, contactsPage],
    queryFn: () => {
      const params: { page: number; per_page: number; search?: string } = {
        page: contactsPage,
        per_page: 20,
      };
      const normalizedSearch = search.trim();
      if (normalizedSearch) {
        params.search = normalizedSearch;
      }
      return contactsApi.list(params);
    },
  });

  const requestsQuery = useQuery({
    queryKey: ['admin', 'lgpd', 'requests'],
    queryFn: () => contactsApi.listLgpdRequests({ page: 1, per_page: 20 }),
  });

  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings) return;
    setRetentionEnabled(Boolean(settings.lgpd_retention_enabled));
    setRetentionDays(settings.lgpd_retention_days ?? 180);
  }, [settingsQuery.data]);

  const updateConsentMutation = useMutation({
    mutationFn: (params: { contactId: string; status: ConsentStatus }) => (
      contactsApi.updateLgpdConsent(params.contactId, {
        status: params.status,
        source: 'admin_lgpd_panel',
      })
    ),
    onSuccess: async () => {
      toast.success(t('lgpd.messages.consentUpdated'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'requests'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const saveRetentionMutation = useMutation({
    mutationFn: () => adminApi.updateSettings({
      lgpd_retention_enabled: retentionEnabled,
      lgpd_retention_days: retentionDays,
    }),
    onSuccess: async () => {
      toast.success(t('lgpd.messages.retentionSaved'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const contacts = contactsQuery.data?.data ?? [];
  const contactsMeta = contactsQuery.data?.meta;
  const requests = requestsQuery.data?.data ?? [];

  const handleExport = async (contact: CrmContact) => {
    try {
      const data = await contactsApi.exportLgpdData(contact.id, { include_messages: true });
      const safeName = toSafeFileName(contact.name || 'contato');
      downloadJsonFile(`lgpd-${safeName}-${contact.id.slice(0, 8)}.json`, data);
      toast.success(t('lgpd.messages.exportDone'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'requests'] });
    } catch {
      toast.error(t('tenantAdmin.common.errorLoad'));
    }
  };

  const handleAnonymize = async (contact: CrmContact) => {
    const confirmed = window.confirm(t('lgpd.confirmAnonymize', { name: contact.name }));
    if (!confirmed) return;

    const typedReason = window.prompt(t('lgpd.anonymizeReasonPrompt'), t('lgpd.anonymizeDefaultReason'));
    if (typedReason === null) return;

    try {
      await contactsApi.anonymizeLgpd(contact.id, {
        reason: typedReason.trim() || t('lgpd.anonymizeDefaultReason'),
        redact_messages: true,
      });
      toast.success(t('lgpd.messages.anonymized'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'requests'] });
    } catch {
      toast.error(t('tenantAdmin.common.errorSave'));
    }
  };

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
        <header>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--txt)', letterSpacing: '-0.4px' }}>
            {t('lgpd.title')}
          </h1>
          <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 13 }}>{t('lgpd.subtitle')}</p>
        </header>

        <section
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)',
            padding: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
            {t('lgpd.retention.title')}
          </h2>
          <p style={{ marginTop: 6, marginBottom: 12, color: 'var(--txt-2)', fontSize: 12 }}>
            {t('lgpd.retention.subtitle')}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--txt-2)', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={retentionEnabled}
                onChange={(event) => setRetentionEnabled(event.target.checked)}
              />
              {t('lgpd.retention.enabled')}
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--txt-2)', fontSize: 12 }}>
              {t('lgpd.retention.days')}
              <input
                type="number"
                min={1}
                max={3650}
                value={retentionDays}
                onChange={(event) => setRetentionDays(Number(event.target.value || 180))}
                style={{
                  width: 96,
                  background: 'var(--bg-3)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  color: 'var(--txt)',
                  padding: '6px 8px',
                  fontSize: 12,
                }}
              />
            </label>

            <button
              type="button"
              onClick={() => saveRetentionMutation.mutate()}
              disabled={saveRetentionMutation.isPending}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
              style={{
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: 'var(--on-teal)',
                borderRadius: 'var(--r)',
                fontWeight: 600,
                fontSize: 12,
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              {saveRetentionMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
            </button>
          </div>
        </section>

        <section
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.contacts.title')}</h2>
            <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 12 }}>{t('lgpd.contacts.subtitle')}</p>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setContactsPage(1);
              }}
              placeholder={t('lgpd.contacts.searchPlaceholder')}
              style={{
                marginTop: 10,
                width: '100%',
                maxWidth: 340,
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                color: 'var(--txt)',
                padding: '8px 10px',
                fontSize: 12,
              }}
            />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 940, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.contacts.columns.name')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.contacts.columns.email')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.contacts.columns.consent')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.contacts.columns.updatedAt')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.contacts.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {contactsQuery.isLoading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.loading')}</td>
                  </tr>
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.emptyContacts')}</td>
                  </tr>
                ) : contacts.map((contact) => {
                  const currentStatus = (selectedStatus[contact.id] ?? contact.lgpd_consent_status ?? 'pending') as ConsentStatus;
                  return (
                    <tr key={contact.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>{contact.name}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{contact.email ?? '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <select
                            value={currentStatus}
                            onChange={(event) => setSelectedStatus((prev) => ({
                              ...prev,
                              [contact.id]: event.target.value as ConsentStatus,
                            }))}
                            style={{
                              background: 'var(--bg-3)',
                              border: '1px solid var(--line-2)',
                              borderRadius: 'var(--r)',
                              color: 'var(--txt)',
                              padding: '6px 8px',
                              fontSize: 12,
                            }}
                          >
                            {(['pending', 'granted', 'denied', 'revoked'] as ConsentStatus[]).map((status) => (
                              <option key={status} value={status}>
                                {consentLabel(t, status)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => updateConsentMutation.mutate({ contactId: contact.id, status: currentStatus })}
                            disabled={updateConsentMutation.isPending}
                            style={{
                              border: '1px solid var(--line-2)',
                              background: 'var(--bg-4)',
                              color: 'var(--txt-2)',
                              borderRadius: 'var(--r)',
                              padding: '6px 10px',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            {t('lgpd.contacts.apply')}
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--txt-2)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {contact.updated_at ? new Date(contact.updated_at).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => void handleExport(contact)}
                            style={{
                              border: '1px solid var(--line-2)',
                              background: 'var(--bg-4)',
                              color: 'var(--txt-2)',
                              borderRadius: 'var(--r)',
                              padding: '6px 10px',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            {t('lgpd.actions.export')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleAnonymize(contact)}
                            style={{
                              border: '1px solid rgba(248,113,113,.35)',
                              background: 'var(--red-dim)',
                              color: 'var(--red)',
                              borderRadius: 'var(--r)',
                              padding: '6px 10px',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            {t('lgpd.actions.anonymize')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>
              {t('lgpd.contacts.total', { count: contactsMeta?.total ?? 0 })}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setContactsPage((prev) => Math.max(1, prev - 1))}
                disabled={contactsPage <= 1}
                style={{
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-3)',
                  color: 'var(--txt-2)',
                  borderRadius: 'var(--r)',
                  padding: '6px 10px',
                  fontSize: 12,
                }}
              >
                {t('lgpd.pagination.prev')}
              </button>
              <button
                type="button"
                onClick={() => setContactsPage((prev) => prev + 1)}
                disabled={Boolean(contactsMeta && contactsPage >= contactsMeta.total_pages)}
                style={{
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-3)',
                  color: 'var(--txt-2)',
                  borderRadius: 'var(--r)',
                  padding: '6px 10px',
                  fontSize: 12,
                }}
              >
                {t('lgpd.pagination.next')}
              </button>
            </div>
          </div>
        </section>

        <section
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
              {t('lgpd.requests.title')}
            </h2>
            <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 12 }}>
              {t('lgpd.requests.subtitle')}
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.requests.columns.when')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.requests.columns.contact')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.requests.columns.type')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.requests.columns.status')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('lgpd.requests.columns.by')}</th>
                </tr>
              </thead>
              <tbody>
                {requestsQuery.isLoading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.loading')}</td>
                  </tr>
                ) : requests.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.emptyRequests')}</td>
                  </tr>
                ) : requests.map((request) => (
                  <tr key={request.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {new Date(request.requested_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>{request.contact_name ?? '—'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{t(`lgpd.requestTypes.${request.request_type}`, { defaultValue: request.request_type })}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{request.status}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{request.requested_by_name ?? 'Sistema'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
