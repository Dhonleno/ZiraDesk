import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  portalApi,
  type PortalLgpdConsentStatus,
  type PortalLgpdRequest,
  type PortalLgpdRequestStatus,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';

type RequestTypeForm = 'access' | 'anonymization';

const consentStatuses: PortalLgpdConsentStatus[] = ['pending', 'granted', 'denied', 'revoked'];

function formatDateTime(value: string | null, locale: string) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString(locale);
}

function getRequestStatusClass(status: string): PortalLgpdRequestStatus {
  if (status === 'processed' || status === 'rejected') return status;
  return 'pending';
}

export function PortalLgpd() {
  const { t, i18n } = useTranslation('portal');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [consentStatus, setConsentStatus] = useState<PortalLgpdConsentStatus>('pending');
  const [requestType, setRequestType] = useState<RequestTypeForm>('access');
  const [requestReason, setRequestReason] = useState('');
  const [includeMessages, setIncludeMessages] = useState(true);
  const [rectificationForm, setRectificationForm] = useState({
    name: '',
    email: '',
    phone: '',
    document: '',
  });

  const { data: portalMe } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => portalApi.getMe(),
  });

  const { data: lgpdState, isLoading } = useQuery({
    queryKey: ['portal-lgpd'],
    queryFn: () => portalApi.getLgpdState(),
  });

  useEffect(() => {
    if (!lgpdState?.consent.status) return;
    const status = lgpdState.consent.status;
    if (status === 'pending' || status === 'granted' || status === 'denied' || status === 'revoked') {
      setConsentStatus(status);
    }
  }, [lgpdState?.consent.status]);

  useEffect(() => {
    if (!portalMe) return;
    setRectificationForm({
      name: portalMe.name ?? '',
      email: portalMe.email ?? '',
      phone: portalMe.phone ?? '',
      document: '',
    });
  }, [portalMe]);

  const updateConsentMutation = useMutation({
    mutationFn: (status: PortalLgpdConsentStatus) =>
      portalApi.updateLgpdConsent({ status, source: 'portal_privacy_center' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal-lgpd'] });
      toast.success(t('lgpd.messages.consentSaved'));
    },
    onError: () => toast.error(t('lgpd.messages.consentError')),
  });

  const createRequestMutation = useMutation({
    mutationFn: () =>
      portalApi.createLgpdRequest({
        request_type: requestType,
        ...(requestReason.trim() ? { reason: requestReason.trim() } : {}),
        include_messages: includeMessages,
      }),
    onSuccess: async () => {
      setRequestReason('');
      setIncludeMessages(true);
      setRequestType('access');
      await queryClient.invalidateQueries({ queryKey: ['portal-lgpd'] });
      toast.success(t('lgpd.messages.requestCreated'));
    },
    onError: () => toast.error(t('lgpd.messages.requestError')),
  });

  const rectificationMutation = useMutation({
    mutationFn: async () => {
      const current = {
        name: portalMe?.name?.trim() ?? '',
        email: portalMe?.email?.trim() ?? '',
        phone: portalMe?.phone?.trim() ?? '',
        document: '',
      };
      const payload = {
        ...(rectificationForm.name.trim() && rectificationForm.name.trim() !== current.name
          ? { name: rectificationForm.name.trim() }
          : {}),
        ...(rectificationForm.email.trim() && rectificationForm.email.trim() !== current.email
          ? { email: rectificationForm.email.trim() }
          : {}),
        ...(rectificationForm.phone.trim() && rectificationForm.phone.trim() !== current.phone
          ? { phone: rectificationForm.phone.trim() }
          : {}),
        ...(rectificationForm.document.trim() && rectificationForm.document.trim() !== current.document
          ? { document: rectificationForm.document.trim() }
          : {}),
      };
      if (Object.keys(payload).length === 0) {
        throw new Error('no_changes');
      }
      return portalApi.requestContactDataRectification(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal-lgpd'] });
      toast.success(t('lgpd.messages.rectificationCreated'));
    },
    onError: (error: unknown) => {
      if (error instanceof Error && error.message === 'no_changes') {
        toast.error(t('lgpd.messages.rectificationNoChanges'));
        return;
      }
      toast.error(t('lgpd.messages.rectificationError'));
    },
  });

  const sortedRequests = useMemo(
    () => [...(lgpdState?.requests ?? [])].sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at)),
    [lgpdState?.requests],
  );

  return (
    <div className="portal-section">
      <div className="portal-page-header">
        <div>
          <h2>{t('lgpd.title')}</h2>
          <p>{t('lgpd.subtitle')}</p>
        </div>
      </div>

      <section className="portal-lgpd-card" style={{ marginTop: 16 }}>
        <h3>{t('lgpd.rectification.title')}</h3>
        <p className="portal-lgpd-help">{t('lgpd.rectification.help')}</p>

        <div className="portal-lgpd-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="portal-field">
            <label htmlFor="portal-lgpd-rectification-name">{t('lgpd.rectification.fields.name')}</label>
            <input
              id="portal-lgpd-rectification-name"
              value={rectificationForm.name}
              onChange={(event) => setRectificationForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>

          <div className="portal-field">
            <label htmlFor="portal-lgpd-rectification-email">{t('lgpd.rectification.fields.email')}</label>
            <input
              id="portal-lgpd-rectification-email"
              type="email"
              value={rectificationForm.email}
              onChange={(event) => setRectificationForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </div>

          <div className="portal-field">
            <label htmlFor="portal-lgpd-rectification-phone">{t('lgpd.rectification.fields.phone')}</label>
            <input
              id="portal-lgpd-rectification-phone"
              value={rectificationForm.phone}
              onChange={(event) => setRectificationForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
          </div>

          <div className="portal-field">
            <label htmlFor="portal-lgpd-rectification-document">{t('lgpd.rectification.fields.document')}</label>
            <input
              id="portal-lgpd-rectification-document"
              value={rectificationForm.document}
              onChange={(event) => setRectificationForm((prev) => ({ ...prev, document: event.target.value }))}
            />
          </div>
        </div>

        <p className="portal-lgpd-help">{t('lgpd.rectification.warning')}</p>

        <button
          type="button"
          className="portal-btn-primary portal-btn-inline"
          disabled={rectificationMutation.isPending}
          onClick={() => rectificationMutation.mutate()}
        >
          {t('lgpd.rectification.submit')}
        </button>
      </section>

      <div className="portal-lgpd-grid">
        <section className="portal-lgpd-card">
          <h3>{t('lgpd.consent.title')}</h3>
          <p className="portal-lgpd-help">{t('lgpd.consent.help')}</p>

          <div className="portal-field">
            <label htmlFor="portal-lgpd-consent-status">{t('lgpd.consent.statusLabel')}</label>
            <select
              id="portal-lgpd-consent-status"
              value={consentStatus}
              onChange={(event) => setConsentStatus(event.target.value as PortalLgpdConsentStatus)}
            >
              {consentStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`lgpd.consent.status.${status}`)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="portal-btn-primary portal-btn-inline"
            disabled={isLoading || updateConsentMutation.isPending}
            onClick={() => updateConsentMutation.mutate(consentStatus)}
          >
            {t('lgpd.consent.save')}
          </button>

          <div className="portal-lgpd-meta-list">
            <div className="portal-lgpd-meta-item">
              <span>{t('lgpd.consent.updatedAt')}</span>
              <strong>{formatDateTime(lgpdState?.consent.at ?? null, i18n.language)}</strong>
            </div>
            <div className="portal-lgpd-meta-item">
              <span>{t('lgpd.consent.source')}</span>
              <strong>{lgpdState?.consent.source ?? '-'}</strong>
            </div>
            <div className="portal-lgpd-meta-item">
              <span>{t('lgpd.consent.lastExport')}</span>
              <strong>{formatDateTime(lgpdState?.consent.last_export_at ?? null, i18n.language)}</strong>
            </div>
          </div>
        </section>

        <section className="portal-lgpd-card">
          <h3>{t('lgpd.request.title')}</h3>
          <p className="portal-lgpd-help">{t('lgpd.request.help')}</p>

          <div className="portal-field">
            <label htmlFor="portal-lgpd-request-type">{t('lgpd.request.type')}</label>
            <select
              id="portal-lgpd-request-type"
              value={requestType}
              onChange={(event) => setRequestType(event.target.value as RequestTypeForm)}
            >
              <option value="access">{t('lgpd.request.types.access')}</option>
              <option value="anonymization">{t('lgpd.request.types.anonymization')}</option>
            </select>
          </div>

          <div className="portal-field">
            <label htmlFor="portal-lgpd-request-reason">{t('lgpd.request.reason')}</label>
            <textarea
              id="portal-lgpd-request-reason"
              rows={4}
              value={requestReason}
              onChange={(event) => setRequestReason(event.target.value)}
              placeholder={t('lgpd.request.reasonPlaceholder')}
            />
          </div>

          <label className="portal-lgpd-checkbox" htmlFor="portal-lgpd-include-messages">
            <input
              id="portal-lgpd-include-messages"
              type="checkbox"
              checked={includeMessages}
              onChange={(event) => setIncludeMessages(event.target.checked)}
            />
            <span>{t('lgpd.request.includeMessages')}</span>
          </label>

          <button
            type="button"
            className="portal-btn-primary portal-btn-inline"
            disabled={createRequestMutation.isPending}
            onClick={() => createRequestMutation.mutate()}
          >
            {t('lgpd.request.submit')}
          </button>
        </section>
      </div>

      <section className="portal-lgpd-history">
        <h3>{t('lgpd.history.title')}</h3>
        <div className="portal-ticket-list">
          {sortedRequests.map((request: PortalLgpdRequest) => (
            <div key={request.id} className="portal-ticket-row portal-lgpd-request-row">
              <div>
                <div className="portal-ticket-title">
                  {t(`lgpd.request.types.${request.request_type}`, { defaultValue: request.request_type })}
                </div>
                <div className="portal-ticket-meta">
                  {t('lgpd.history.requestedAt')}: {formatDateTime(request.requested_at, i18n.language)}
                </div>
              </div>
              <span className={`portal-status portal-lgpd-status-${getRequestStatusClass(request.status)}`}>
                {t(`lgpd.history.status.${request.status}`, { defaultValue: request.status })}
              </span>
            </div>
          ))}
          {!isLoading && sortedRequests.length === 0 ? <p className="portal-empty">{t('lgpd.history.empty')}</p> : null}
        </div>
      </section>
    </div>
  );
}
