import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { profileApi, type UserLgpdRequest } from '../../services/api';
import { useToast } from '../../stores/toast.store';

type ConsentStatus = 'pending' | 'granted' | 'denied' | 'revoked';
type RequestType = 'access' | 'anonymization';

function toSafeFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

export function Privacy() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [consentStatus, setConsentStatus] = useState<ConsentStatus>('pending');
  const [requestType, setRequestType] = useState<RequestType>('access');
  const [reason, setReason] = useState('');

  const lgpdQuery = useQuery({
    queryKey: ['profile', 'lgpd'],
    queryFn: profileApi.getLgpdState,
  });

  useEffect(() => {
    if (lgpdQuery.data) {
      setConsentStatus((lgpdQuery.data.consent.status as ConsentStatus) ?? 'pending');
    }
  }, [lgpdQuery.data]);

  const consentMutation = useMutation({
    mutationFn: () => profileApi.updateLgpdConsent({ status: consentStatus }),
    onSuccess: async () => {
      toast.success(t('lgpd.privacy.messages.consentSaved'));
      await queryClient.invalidateQueries({ queryKey: ['profile', 'lgpd'] });
    },
    onError: () => toast.error(t('lgpd.privacy.messages.consentError')),
  });

  const requestMutation = useMutation({
    mutationFn: () => {
      const trimmed = reason.trim();
      return profileApi.createAnonymizeRequest(trimmed ? { reason: trimmed } : {});
    },
    onSuccess: async () => {
      toast.success(t('lgpd.privacy.messages.requestCreated'));
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['profile', 'lgpd'] });
    },
    onError: () => toast.error(t('lgpd.privacy.messages.requestError')),
  });

  const handleExport = async () => {
    try {
      const data = await profileApi.exportLgpdData({ include_audit_logs: true });
      const name = toSafeFileName(data.user.name || 'usuario');
      downloadJsonFile(`lgpd-${name}-${data.user.id.slice(0, 8)}.json`, data);
      toast.success(t('lgpd.privacy.messages.exportDone'));
      await queryClient.invalidateQueries({ queryKey: ['profile', 'lgpd'] });
    } catch {
      toast.error(t('tenantAdmin.common.errorLoad'));
    }
  };

  const lgpdState = lgpdQuery.data;
  const requests: UserLgpdRequest[] = lgpdState?.requests ?? [];

  const inputStyle = {
    width: '100%',
    background: 'var(--bg-3)',
    border: '1px solid var(--line-2)',
    borderRadius: 'var(--r)',
    color: 'var(--txt)',
    padding: '8px 10px',
    fontSize: 13,
  } as const;

  const sectionStyle = {
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-lg)',
    background: 'var(--bg-2)',
    padding: 20,
    marginBottom: 16,
  } as const;

  const sectionTitleStyle = {
    margin: '0 0 4px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--txt)',
  } as const;

  const helpStyle = {
    margin: '0 0 14px',
    fontSize: 12,
    color: 'var(--txt-2)',
  } as const;

  const labelStyle = {
    display: 'block',
    fontSize: 12,
    color: 'var(--txt-2)',
    marginBottom: 6,
  } as const;

  const btnPrimaryStyle = {
    border: '1px solid var(--teal)',
    background: 'var(--teal)',
    color: 'var(--on-teal)',
    borderRadius: 'var(--r)',
    fontWeight: 600,
    fontSize: 12,
    padding: '8px 14px',
    cursor: 'pointer',
  } as const;

  const btnSecondaryStyle = {
    border: '1px solid var(--line-2)',
    background: 'var(--bg-4)',
    color: 'var(--txt-2)',
    borderRadius: 'var(--r)',
    fontSize: 12,
    padding: '8px 14px',
    cursor: 'pointer',
  } as const;

  return (
    <PageShell padding={0}>
      <div style={{ maxWidth: 680, padding: 24 }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--txt)', letterSpacing: '-0.3px' }}>
            {t('lgpd.privacy.title')}
          </h1>
          <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 13 }}>{t('lgpd.privacy.subtitle')}</p>
        </header>

        {/* Consentimento */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>{t('lgpd.privacy.consent.title')}</h2>
          <p style={helpStyle}>{t('lgpd.privacy.consent.help')}</p>

          <label style={labelStyle}>{t('lgpd.privacy.consent.statusLabel')}</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={consentStatus}
              onChange={(e) => setConsentStatus(e.target.value as ConsentStatus)}
              style={{ ...inputStyle, width: 200 }}
            >
              {(['pending', 'granted', 'denied', 'revoked'] as ConsentStatus[]).map((s) => (
                <option key={s} value={s}>{t(`lgpd.consentStatus.${s}`)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => consentMutation.mutate()}
              disabled={consentMutation.isPending}
              style={btnPrimaryStyle}
            >
              {consentMutation.isPending ? t('tenantAdmin.common.saving') : t('lgpd.privacy.consent.save')}
            </button>
          </div>

          {lgpdState && (
            <div style={{ marginTop: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {lgpdState.consent.updated_at && (
                <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                  {t('lgpd.privacy.consent.updatedAt')}: {new Date(lgpdState.consent.updated_at).toLocaleString()}
                </span>
              )}
              {lgpdState.consent.source && (
                <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                  {t('lgpd.privacy.consent.source')}: {lgpdState.consent.source}
                </span>
              )}
              {lgpdState.consent.last_export_at && (
                <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                  {t('lgpd.privacy.consent.lastExport')}: {new Date(lgpdState.consent.last_export_at).toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Exportar dados */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>{t('lgpd.privacy.export.title')}</h2>
          <p style={helpStyle}>{t('lgpd.privacy.export.help')}</p>
          <button type="button" onClick={() => void handleExport()} style={btnSecondaryStyle}>
            {t('lgpd.privacy.export.button')}
          </button>
        </div>

        {/* Solicitar ação */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>{t('lgpd.privacy.request.title')}</h2>
          <p style={helpStyle}>{t('lgpd.privacy.request.help')}</p>

          <label style={labelStyle}>{t('lgpd.privacy.request.type')}</label>
          <select
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as RequestType)}
            style={{ ...inputStyle, marginBottom: 12, width: 280 }}
          >
            <option value="access">{t('lgpd.privacy.request.types.access')}</option>
            <option value="anonymization">{t('lgpd.privacy.request.types.anonymization')}</option>
          </select>

          <label style={labelStyle}>{t('lgpd.privacy.request.reason')}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('lgpd.privacy.request.reasonPlaceholder')}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', marginBottom: 12 }}
          />

          <button
            type="button"
            onClick={() => requestMutation.mutate()}
            disabled={requestMutation.isPending}
            style={btnPrimaryStyle}
          >
            {requestMutation.isPending ? t('tenantAdmin.common.saving') : t('lgpd.privacy.request.submit')}
          </button>
        </div>

        {/* Histórico */}
        <div style={{ ...sectionStyle, marginBottom: 0 }}>
          <h2 style={sectionTitleStyle}>{t('lgpd.privacy.history.title')}</h2>

          {lgpdQuery.isLoading ? (
            <p style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('lgpd.loading')}</p>
          ) : requests.length === 0 ? (
            <p style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('lgpd.privacy.history.empty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {requests.map((req) => (
                <div
                  key={req.id}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--bg-3)',
                    borderRadius: 'var(--r)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--txt)' }}>
                      {t(`lgpd.requestTypes.${req.request_type}`, { defaultValue: req.request_type })}
                    </span>
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--txt-3)' }}>
                      {t('lgpd.privacy.history.requestedAt')}: {new Date(req.requested_at).toLocaleString()}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: req.status === 'processed'
                        ? 'var(--teal-dim)'
                        : req.status === 'rejected'
                        ? 'var(--red-dim)'
                        : 'var(--bg-4)',
                      color: req.status === 'processed'
                        ? 'var(--teal)'
                        : req.status === 'rejected'
                        ? 'var(--red)'
                        : 'var(--txt-2)',
                    }}
                  >
                    {req.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
