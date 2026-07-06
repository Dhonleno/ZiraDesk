import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { RejectRequestModal } from '../../components/admin/RejectRequestModal';
import { adminApi, contactsApi, type CrmContact, type TenantUser, type UserLgpdRequest } from '../../services/api';
import { useToast } from '../../stores/toast.store';

type ConsentStatus = 'pending' | 'granted' | 'denied' | 'revoked';
type ActiveTab = 'contacts' | 'users' | 'external';

function consentLabel(t: (key: string) => string, status: ConsentStatus): string {
  return t(`lgpd.consentStatus.${status}`);
}

function toSafeFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function extractRectificationRequestedChanges(payload: Record<string, unknown>): Record<string, string> {
  const raw = payload.requested_changes;
  const source = (raw && typeof raw === 'object' ? raw : payload) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of ['name', 'email', 'phone', 'document'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      result[key] = value.trim();
    }
  }
  return result;
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

const thStyle = {
  textAlign: 'left' as const,
  padding: '10px 12px',
  fontSize: 10,
  color: 'var(--txt-3)',
  textTransform: 'uppercase' as const,
};

const actionBtnStyle = {
  border: '1px solid var(--line-2)',
  background: 'var(--bg-4)',
  color: 'var(--txt-2)',
  borderRadius: 'var(--r)',
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
} as const;

const dangerBtnStyle = {
  border: '1px solid rgba(248,113,113,.35)',
  background: 'var(--red-dim)',
  color: 'var(--red)',
  borderRadius: 'var(--r)',
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
} as const;

const selectStyle = {
  background: 'var(--bg-3)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  color: 'var(--txt)',
  padding: '6px 8px',
  fontSize: 12,
} as const;

// ─── Process request modal ────────────────────────────────────────────────────

interface ProcessModalProps {
  requestId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ProcessModal({ requestId, onClose, onSuccess }: ProcessModalProps) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [notes, setNotes] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: { action: 'approve' | 'reject'; notes?: string } = { action };
      const trimmed = notes.trim();
      if (trimmed) payload.notes = trimmed;
      return adminApi.processLgpdRequest(requestId, payload);
    },
    onSuccess: () => {
      toast.success(action === 'approve' ? t('lgpd.messages.requestApproved') : t('lgpd.messages.requestRejected'));
      onSuccess();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-lg)', width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.processModal.title')}</h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--txt-2)' }}>{t('lgpd.processModal.subtitle')}</p>

        <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)', fontWeight: 500 }}>
          {t('lgpd.processModal.action')}
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['approve', 'reject'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setAction(opt)}
              style={{
                flex: 1,
                padding: '7px 0',
                borderRadius: 'var(--r)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                border: action === opt
                  ? (opt === 'approve' ? '2px solid var(--teal)' : '2px solid var(--red)')
                  : '2px solid var(--line-2)',
                background: action === opt
                  ? (opt === 'approve' ? 'var(--teal-dim)' : 'var(--red-dim)')
                  : 'var(--bg-3)',
                color: action === opt
                  ? (opt === 'approve' ? 'var(--teal)' : 'var(--red)')
                  : 'var(--txt-3)',
              }}
            >
              {t(`lgpd.processModal.${opt}`)}
            </button>
          ))}
        </div>

        <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--txt-2)', fontWeight: 500 }}>
          {t('lgpd.processModal.notes')}
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('lgpd.processModal.notesPlaceholder')}
          rows={3}
          style={{ width: '100%', resize: 'vertical', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', color: 'var(--txt)', padding: '8px 10px', fontSize: 12, boxSizing: 'border-box' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={actionBtnStyle}>{t('lgpd.processModal.cancel')}</button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            style={{
              border: `1px solid ${action === 'approve' ? 'var(--teal)' : 'rgba(248,113,113,.35)'}`,
              background: action === 'approve' ? 'var(--teal)' : 'var(--red-dim)',
              color: action === 'approve' ? 'var(--on-teal)' : 'var(--red)',
              borderRadius: 'var(--r)',
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: mutation.isPending ? 'not-allowed' : 'pointer',
              opacity: mutation.isPending ? 0.6 : 1,
            }}
          >
            {mutation.isPending ? t('lgpd.processModal.processing') : t('lgpd.processModal.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SLA Dashboard cards ──────────────────────────────────────────────────────

function LgpdDashboard() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const dashboardQuery = useQuery({
    queryKey: ['admin', 'lgpd', 'dashboard'],
    queryFn: adminApi.getLgpdDashboard,
    refetchInterval: 60_000,
  });

  const data = dashboardQuery.data;

  const cardStyle = (color: 'teal' | 'yellow' | 'red' | 'gray') => ({
    flex: 1,
    minWidth: 140,
    background: 'var(--bg-2)',
    border: `1px solid ${color === 'red' ? 'rgba(248,113,113,.25)' : color === 'yellow' ? 'rgba(245,158,11,.25)' : 'var(--line)'}`,
    borderRadius: 'var(--r-lg)',
    padding: '14px 16px',
  });

  const numberStyle = (color: 'teal' | 'yellow' | 'red' | 'gray') => ({
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1,
    color: color === 'red' ? 'var(--red)' : color === 'yellow' ? '#d97706' : color === 'teal' ? 'var(--teal)' : 'var(--txt)',
  });

  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-3)', padding: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.dashboard.title')}</h2>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={cardStyle('gray')}>
          <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 4 }}>{t('lgpd.dashboard.pending')}</div>
          <div style={numberStyle('gray')}>{data?.total_pending ?? '—'}</div>
        </div>
        <div style={cardStyle('yellow')}>
          <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 4 }}>{t('lgpd.dashboard.expiring7d')}</div>
          <div style={numberStyle('yellow')}>{data?.expiring_7d ?? '—'}</div>
        </div>
        <div style={cardStyle('red')}>
          <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 4 }}>{t('lgpd.dashboard.expiring24h')}</div>
          <div style={numberStyle('red')}>{data?.expiring_24h ?? '—'}</div>
        </div>
        <div style={cardStyle('red')}>
          <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 4 }}>{t('lgpd.dashboard.breached')}</div>
          <div style={numberStyle('red')}>{data?.breached ?? '—'}</div>
        </div>
      </div>

      {/* Oldest pending list */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 8 }}>{t('lgpd.dashboard.oldestPending')}</div>
      {dashboardQuery.isLoading ? (
        <p style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('lgpd.loading')}</p>
      ) : !data?.oldest_pending.length ? (
        <p style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('lgpd.dashboard.noOldestPending')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.oldest_pending.map((req) => {
            const isBreached = req.sla_deadline && new Date(req.sla_deadline) < new Date();
            return (
              <div
                key={req.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: 'var(--bg-2)', borderRadius: 'var(--r)', padding: '8px 12px',
                  border: isBreached ? '1px solid rgba(248,113,113,.3)' : '1px solid var(--line)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 500 }}>{req.subject_label}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--txt-3)' }}>{req.request_type}</span>
                </div>
                {req.sla_deadline && (
                  <span style={{ fontSize: 11, color: isBreached ? 'var(--red)' : 'var(--txt-3)', whiteSpace: 'nowrap' }}>
                    {t('lgpd.dashboard.slaDeadline')}: {new Date(req.sla_deadline).toLocaleDateString()}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setProcessingId(req.id)}
                  style={{ ...actionBtnStyle, whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {t('lgpd.dashboard.process')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {processingId && (
        <ProcessModal
          requestId={processingId}
          onClose={() => setProcessingId(null)}
          onSuccess={async () => {
            setProcessingId(null);
            await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd'] });
          }}
        />
      )}
    </section>
  );
}

// ─── Contacts tab ────────────────────────────────────────────────────────────

function ContactsTab() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedStatus, setSelectedStatus] = useState<Record<string, ConsentStatus>>({});
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; message: string; onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const openConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmState({ open: true, title, message, onConfirm });
  };

  const contactsQuery = useQuery({
    queryKey: ['admin', 'lgpd', 'contacts', search, page],
    queryFn: () => {
      const params: { page: number; per_page: number; search?: string } = { page, per_page: 20 };
      const normalized = search.trim();
      if (normalized) params.search = normalized;
      return contactsApi.list(params);
    },
  });

  const requestsQuery = useQuery({
    queryKey: ['admin', 'lgpd', 'requests'],
    queryFn: () => contactsApi.listLgpdRequests({ page: 1, per_page: 20 }),
  });

  const updateConsentMutation = useMutation({
    mutationFn: (params: { contactId: string; status: ConsentStatus }) =>
      contactsApi.updateLgpdConsent(params.contactId, { status: params.status, source: 'admin_lgpd_panel' }),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.lgpd.messages.consentUpdated'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'requests'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const approveRectificationMutation = useMutation({
    mutationFn: (requestId: string) => contactsApi.approveLgpdRequest(requestId),
    onSuccess: async () => {
      toast.success(t('lgpd.messages.requestApproved'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'requests'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const rejectRectificationMutation = useMutation({
    mutationFn: (params: { requestId: string; reason: string }) =>
      contactsApi.rejectLgpdRequest(params.requestId, { reason: params.reason }),
    onSuccess: async () => {
      toast.success(t('lgpd.messages.requestRejected'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'requests'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const handleExport = async (contact: CrmContact) => {
    try {
      const data = await contactsApi.exportLgpdData(contact.id, { include_messages: true });
      const safeName = toSafeFileName(contact.name || 'contato');
      downloadJsonFile(`lgpd-${safeName}-${contact.id.slice(0, 8)}.json`, data);
      toast.success(t('tenantAdmin.lgpd.messages.exportDone'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'requests'] });
    } catch {
      toast.error(t('tenantAdmin.common.errorLoad'));
    }
  };

  const handleAnonymize = async (contactId: string) => {
    const typedReason = window.prompt(t('lgpd.anonymizeReasonPrompt'), t('lgpd.anonymizeDefaultReason'));
    if (typedReason === null) return;
    try {
      await contactsApi.anonymizeLgpd(contactId, {
        reason: typedReason.trim() || t('lgpd.anonymizeDefaultReason'),
        redact_messages: true,
      });
      toast.success(t('tenantAdmin.lgpd.messages.anonymized'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'requests'] });
    } catch {
      toast.error(t('tenantAdmin.common.errorSave'));
    }
  };

  const contacts = contactsQuery.data?.data ?? [];
  const meta = contactsQuery.data?.meta;
  const requests = requestsQuery.data?.data ?? [];

  const handleApproveRectification = (requestId: string) => {
    approveRectificationMutation.mutate(requestId);
  };

  const handleConfirmReject = async (reason: string): Promise<void> => {
    if (!rejectTargetId) return;
    await rejectRectificationMutation.mutateAsync({ requestId: rejectTargetId, reason });
    setRejectTargetId(null);
  };

  return (
    <>
      {/* Contacts table */}
      <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.contacts.title')}</h2>
          <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 12 }}>{t('lgpd.contacts.subtitle')}</p>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('lgpd.contacts.searchPlaceholder')}
            style={{ marginTop: 10, width: '100%', maxWidth: 340, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', color: 'var(--txt)', padding: '8px 10px', fontSize: 12 }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 940, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                <th style={thStyle}>{t('lgpd.contacts.columns.name')}</th>
                <th style={thStyle}>{t('lgpd.contacts.columns.email')}</th>
                <th style={thStyle}>{t('lgpd.contacts.columns.consent')}</th>
                <th style={thStyle}>{t('lgpd.contacts.columns.updatedAt')}</th>
                <th style={thStyle}>{t('lgpd.contacts.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {contactsQuery.isLoading ? (
                <tr><td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.loading')}</td></tr>
              ) : contacts.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.emptyContacts')}</td></tr>
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
                          onChange={(e) => setSelectedStatus((prev) => ({ ...prev, [contact.id]: e.target.value as ConsentStatus }))}
                          style={selectStyle}
                        >
                          {(['pending', 'granted', 'denied', 'revoked'] as ConsentStatus[]).map((s) => (
                            <option key={s} value={s}>{consentLabel(t, s)}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => updateConsentMutation.mutate({ contactId: contact.id, status: currentStatus })} disabled={updateConsentMutation.isPending} style={actionBtnStyle}>
                          {t('lgpd.contacts.apply')}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {contact.updated_at ? new Date(contact.updated_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button type="button" onClick={() => void handleExport(contact)} style={actionBtnStyle}>{t('lgpd.actions.export')}</button>
                        <button type="button" onClick={() => openConfirm(t('lgpd.anonymizeTitle'), t('lgpd.confirmAnonymize', { name: contact.name }), () => void handleAnonymize(contact.id))} style={dangerBtnStyle}>{t('lgpd.actions.anonymize')}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('lgpd.contacts.total', { count: meta?.total ?? 0 })}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={actionBtnStyle}>{t('lgpd.pagination.prev')}</button>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={Boolean(meta && page >= meta.total_pages)} style={actionBtnStyle}>{t('lgpd.pagination.next')}</button>
          </div>
        </div>
      </section>

      <RejectRequestModal
        isOpen={rejectTargetId !== null}
        onClose={() => setRejectTargetId(null)}
        onConfirm={handleConfirmReject}
      />

      {confirmState.open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.64)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>
          <div className="modal-panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><span>{confirmState.title}</span><button className="tb-icon-btn" onClick={() => setConfirmState((s) => ({ ...s, open: false }))}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></button></div>
            <div className="modal-body"><p style={{ fontSize: 13, color: 'var(--txt-2)', margin: 0 }}>{confirmState.message}</p></div>
            <div className="modal-footer">
              <button className="tb-btn" onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>{t('tenantAdmin.common.cancel')}</button>
              <button className="tb-btn-primary" style={{ background: 'var(--red)', color: '#fff' }} onClick={() => { confirmState.onConfirm(); setConfirmState((s) => ({ ...s, open: false })); }}>{t('tenantAdmin.common.confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Contact requests log */}
      <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.requests.title')}</h2>
          <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 12 }}>{t('lgpd.requests.subtitle')}</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                <th style={thStyle}>{t('lgpd.requests.columns.when')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.contact')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.type')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.status')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.by')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {requestsQuery.isLoading ? (
                <tr><td colSpan={6} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.loading')}</td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.emptyRequests')}</td></tr>
              ) : requests.map((req) => {
                const isRectification = req.request_type === 'rectification';
                const requestedChanges = isRectification
                  ? extractRectificationRequestedChanges(req.payload as Record<string, unknown>)
                  : {};
                const diffEntries = isRectification
                  ? ([
                    { key: 'name', label: t('lgpd.rectification.fields.name'), current: req.contact_name ?? '', requested: requestedChanges.name ?? '' },
                    { key: 'email', label: t('lgpd.rectification.fields.email'), current: req.contact_email ?? '', requested: requestedChanges.email ?? '' },
                    { key: 'phone', label: t('lgpd.rectification.fields.phone'), current: req.contact_phone ?? '', requested: requestedChanges.phone ?? '' },
                    { key: 'document', label: t('lgpd.rectification.fields.document'), current: req.contact_document ?? '', requested: requestedChanges.document ?? '' },
                  ] as const).filter((entry) => entry.requested && entry.requested !== entry.current)
                  : [];
                const expanded = expandedRequestId === req.id;

                return (
                  <Fragment key={req.id}>
                    <tr key={req.id} style={{ borderBottom: expanded ? 'none' : '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--txt-2)', fontFamily: 'var(--mono)', fontSize: 11 }}>{new Date(req.requested_at).toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>{req.contact_name ?? '—'}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{t(`lgpd.requestTypes.${req.request_type}`, { defaultValue: req.request_type })}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{req.status}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{req.requested_by_name ?? t('tenantAdmin.lgpd.system')}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {isRectification && diffEntries.length > 0 && (
                            <button type="button" style={actionBtnStyle} onClick={() => setExpandedRequestId(expanded ? null : req.id)}>
                              {expanded ? t('lgpd.requests.hideDiff') : t('lgpd.requests.showDiff')}
                            </button>
                          )}
                          {isRectification && req.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                style={actionBtnStyle}
                                onClick={() => handleApproveRectification(req.id)}
                                disabled={approveRectificationMutation.isPending || rejectRectificationMutation.isPending}
                              >
                                {t('lgpd.requests.approve')}
                              </button>
                              <button
                                type="button"
                                style={dangerBtnStyle}
                                onClick={() => setRejectTargetId(req.id)}
                                disabled={approveRectificationMutation.isPending}
                              >
                                {t('lgpd.requests.reject')}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr style={{ borderBottom: '1px solid var(--line)' }}>
                        <td colSpan={6} style={{ padding: '10px 12px', background: 'var(--bg-3)' }}>
                          {diffEntries.length === 0 ? (
                            <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('lgpd.requests.noDiff')}</span>
                          ) : (
                            <div style={{ display: 'grid', gap: 6 }}>
                              {diffEntries.map((entry) => (
                                <div key={entry.key} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 1fr', gap: 8, alignItems: 'center' }}>
                                  <span style={{ color: 'var(--txt-2)', fontSize: 12, fontWeight: 600 }}>{entry.label}</span>
                                  <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>{entry.current || '—'}</span>
                                  <span style={{ color: 'var(--txt)', fontSize: 12, fontWeight: 600 }}>{entry.requested || '—'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ─── Users tab ───────────────────────────────────────────────────────────────

function UsersTab() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedStatus, setSelectedStatus] = useState<Record<string, ConsentStatus>>({});

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; message: string; onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const openConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmState({ open: true, title, message, onConfirm });
  };

  const usersQuery = useQuery({
    queryKey: ['admin', 'lgpd', 'users', search, page],
    queryFn: () => {
      const params: { page: number; per_page: number; search?: string } = { page, per_page: 20 };
      const normalized = search.trim();
      if (normalized) params.search = normalized;
      return adminApi.listUsers(params);
    },
  });

  const userRequestsQuery = useQuery({
    queryKey: ['admin', 'lgpd', 'userRequests'],
    queryFn: () => adminApi.listUserLgpdRequests({ page: 1, per_page: 20 }),
  });

  const updateConsentMutation = useMutation({
    mutationFn: (params: { userId: string; status: ConsentStatus }) =>
      adminApi.updateUserLgpdConsent(params.userId, { status: params.status, source: 'admin_lgpd_panel' }),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.lgpd.messages.consentUpdated'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'users'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'userRequests'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const handleExport = async (user: TenantUser) => {
    try {
      const data = await adminApi.exportUserLgpdData(user.id, { include_audit_logs: true });
      const safeName = toSafeFileName(user.name || 'usuario');
      downloadJsonFile(`lgpd-user-${safeName}-${user.id.slice(0, 8)}.json`, data);
      toast.success(t('tenantAdmin.lgpd.messages.exportDone'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'users'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'userRequests'] });
    } catch {
      toast.error(t('tenantAdmin.common.errorLoad'));
    }
  };

  const handleAnonymize = async (userId: string) => {
    const typedReason = window.prompt(t('lgpd.anonymizeUserReasonPrompt'), t('lgpd.anonymizeDefaultReason'));
    if (typedReason === null) return;
    try {
      await adminApi.anonymizeUserLgpd(userId, { reason: typedReason.trim() || t('lgpd.anonymizeDefaultReason') });
      toast.success(t('lgpd.messages.userAnonymized'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'users'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'userRequests'] });
    } catch {
      toast.error(t('tenantAdmin.common.errorSave'));
    }
  };

  const users = usersQuery.data?.data ?? [];
  const meta = usersQuery.data?.meta;
  const userRequests: UserLgpdRequest[] = userRequestsQuery.data?.data ?? [];

  return (
    <>
      {/* Users table */}
      <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.users.title')}</h2>
          <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 12 }}>{t('lgpd.users.subtitle')}</p>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('lgpd.users.searchPlaceholder')}
            style={{ marginTop: 10, width: '100%', maxWidth: 340, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', color: 'var(--txt)', padding: '8px 10px', fontSize: 12 }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                <th style={thStyle}>{t('lgpd.users.columns.name')}</th>
                <th style={thStyle}>{t('lgpd.users.columns.email')}</th>
                <th style={thStyle}>{t('lgpd.users.columns.role')}</th>
                <th style={thStyle}>{t('lgpd.users.columns.consent')}</th>
                <th style={thStyle}>{t('lgpd.users.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.isLoading ? (
                <tr><td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.loading')}</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('tenantAdmin.lgpd.users.empty')}</td></tr>
              ) : users.map((user) => {
                const currentStatus = (selectedStatus[user.id] ?? user.lgpd_consent_status ?? 'pending') as ConsentStatus;
                const isAnonymized = Boolean(user.lgpd_anonymized_at);
                return (
                  <tr key={user.id} style={{ borderBottom: '1px solid var(--line)', opacity: isAnonymized ? 0.6 : 1 }}>
                    <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>
                      {user.name}
                      {isAnonymized && (
                        <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 999, background: 'var(--bg-4)', color: 'var(--txt-3)' }}>
                          {t('tenantAdmin.lgpd.users.anonymizedBadge')}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{user.email}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{user.role}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                          value={currentStatus}
                          onChange={(e) => setSelectedStatus((prev) => ({ ...prev, [user.id]: e.target.value as ConsentStatus }))}
                          disabled={isAnonymized}
                          style={selectStyle}
                        >
                          {(['pending', 'granted', 'denied', 'revoked'] as ConsentStatus[]).map((s) => (
                            <option key={s} value={s}>{consentLabel(t, s)}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => updateConsentMutation.mutate({ userId: user.id, status: currentStatus })}
                          disabled={updateConsentMutation.isPending || isAnonymized}
                          style={actionBtnStyle}
                        >
                          {t('lgpd.contacts.apply')}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button type="button" onClick={() => void handleExport(user)} disabled={isAnonymized} style={actionBtnStyle}>{t('lgpd.actions.export')}</button>
                        {!isAnonymized && (
                          <button type="button" onClick={() => openConfirm(t('lgpd.anonymizeTitle'), t('lgpd.confirmAnonymizeUser', { name: user.name }), () => void handleAnonymize(user.id))} style={dangerBtnStyle}>{t('lgpd.actions.anonymize')}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('lgpd.users.total', { count: meta?.total ?? 0 })}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={actionBtnStyle}>{t('lgpd.pagination.prev')}</button>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={Boolean(meta && page >= meta.total_pages)} style={actionBtnStyle}>{t('lgpd.pagination.next')}</button>
          </div>
        </div>
      </section>

      {/* User requests log */}
      <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.userRequests.title')}</h2>
          <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 12 }}>{t('lgpd.userRequests.subtitle')}</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                <th style={thStyle}>{t('lgpd.requests.columns.when')}</th>
                <th style={thStyle}>{t('lgpd.userRequests.columns.user')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.type')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.status')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.by')}</th>
              </tr>
            </thead>
            <tbody>
              {userRequestsQuery.isLoading ? (
                <tr><td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.loading')}</td></tr>
              ) : userRequests.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('tenantAdmin.lgpd.userRequests.empty')}</td></tr>
              ) : userRequests.map((req) => (
                <tr key={req.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--txt-2)', fontFamily: 'var(--mono)', fontSize: 11 }}>{new Date(req.requested_at).toLocaleString()}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>{req.user_name ?? '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{t(`lgpd.requestTypes.${req.request_type}`, { defaultValue: req.request_type })}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: req.status === 'processed' ? 'var(--teal-dim)' : req.status === 'rejected' ? 'var(--red-dim)' : 'var(--bg-4)',
                      color: req.status === 'processed' ? 'var(--teal)' : req.status === 'rejected' ? 'var(--red)' : 'var(--txt-2)',
                    }}>
                      {req.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>{req.requested_by_name ?? t('tenantAdmin.lgpd.system')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {confirmState.open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.64)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>
          <div className="modal-panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><span>{confirmState.title}</span><button className="tb-icon-btn" onClick={() => setConfirmState((s) => ({ ...s, open: false }))}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></button></div>
            <div className="modal-body"><p style={{ fontSize: 13, color: 'var(--txt-2)', margin: 0 }}>{confirmState.message}</p></div>
            <div className="modal-footer">
              <button className="tb-btn" onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>{t('tenantAdmin.common.cancel')}</button>
              <button className="tb-btn-primary" style={{ background: 'var(--red)', color: '#fff' }} onClick={() => { confirmState.onConfirm(); setConfirmState((s) => ({ ...s, open: false })); }}>{t('tenantAdmin.common.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── External requests tab ───────────────────────────────────────────────────

type ExternalStatusFilter = 'all' | 'pending' | 'processed' | 'rejected';

function ExternalRequestsTab() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [externalId, setExternalId] = useState('');
  const [reason, setReason] = useState('');
  const [statusFilter, setStatusFilter] = useState<ExternalStatusFilter>('all');
  const [page, setPage] = useState(1);

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; message: string; onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const openConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmState({ open: true, title, message, onConfirm });
  };

  const requestsQuery = useQuery({
    queryKey: ['admin', 'lgpd', 'external', statusFilter, page],
    queryFn: () => {
      const params: { page: number; per_page: number; status?: string } = { page, per_page: 20 };
      if (statusFilter !== 'all') params.status = statusFilter;
      return adminApi.listExternalLgpdRequests(params);
    },
  });

  const anonymizeMutation = useMutation({
    mutationFn: () => adminApi.anonymizeByExternalId({ external_id: externalId.trim(), reason: reason.trim() }),
    onSuccess: async (data) => {
      toast.success(
        t('lgpd.external.anonymized', {
          conversations: data.summary.conversations_anonymized,
          messages: data.summary.messages_redacted,
        }),
      );
      setExternalId('');
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lgpd', 'external'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const handleSubmit = () => {
    if (!externalId.trim() || !reason.trim()) return;
    openConfirm(
      t('lgpd.anonymizeTitle'),
      t('lgpd.external.confirmAnonymize', { id: externalId.trim() }),
      () => anonymizeMutation.mutate(),
    );
  };

  const requests = requestsQuery.data?.data ?? [];
  const meta = requestsQuery.data?.meta;

  const statusBadgeStyle = (status: string) => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    background:
      status === 'processed' ? 'var(--teal-dim)' :
      status === 'rejected' ? 'var(--red-dim)' :
      'var(--bg-4)',
    color:
      status === 'processed' ? 'var(--teal)' :
      status === 'rejected' ? 'var(--red)' :
      'var(--txt-2)',
  });

  return (
    <>
      {/* Form */}
      <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.external.formTitle')}</h2>
        <p style={{ marginTop: 6, marginBottom: 12, color: 'var(--txt-2)', fontSize: 12 }}>{t('lgpd.external.formSubtitle')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
          <input
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder={t('lgpd.external.externalIdPlaceholder')}
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', color: 'var(--txt)', padding: '8px 10px', fontSize: 12 }}
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('lgpd.external.reasonPlaceholder')}
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', color: 'var(--txt)', padding: '8px 10px', fontSize: 12 }}
          />
          <div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!externalId.trim() || !reason.trim() || anonymizeMutation.isPending}
              style={{
                border: '1px solid rgba(248,113,113,.35)',
                background: 'var(--red-dim)',
                color: 'var(--red)',
                borderRadius: 'var(--r)',
                padding: '7px 14px',
                fontSize: 12,
                fontWeight: 600,
                cursor: (!externalId.trim() || !reason.trim() || anonymizeMutation.isPending) ? 'not-allowed' : 'pointer',
                opacity: (!externalId.trim() || !reason.trim() || anonymizeMutation.isPending) ? 0.6 : 1,
              }}
            >
              {anonymizeMutation.isPending ? t('lgpd.external.processing') : t('lgpd.external.submitBtn')}
            </button>
          </div>
        </div>
      </section>

      {/* Requests list */}
      <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.external.listTitle')}</h2>
            <p style={{ marginTop: 4, color: 'var(--txt-2)', fontSize: 12 }}>{t('lgpd.external.listSubtitle')}</p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as ExternalStatusFilter); setPage(1); }}
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', color: 'var(--txt)', padding: '6px 8px', fontSize: 12 }}
          >
            <option value="all">{t('lgpd.external.filter.all')}</option>
            <option value="pending">{t('lgpd.external.filter.pending')}</option>
            <option value="processed">{t('lgpd.external.filter.processed')}</option>
            <option value="rejected">{t('lgpd.external.filter.rejected')}</option>
          </select>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                <th style={thStyle}>{t('lgpd.requests.columns.when')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.type')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.status')}</th>
                <th style={thStyle}>{t('lgpd.external.columns.result')}</th>
                <th style={thStyle}>{t('lgpd.requests.columns.by')}</th>
              </tr>
            </thead>
            <tbody>
              {requestsQuery.isLoading ? (
                <tr><td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.loading')}</td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 16, color: 'var(--txt-3)' }}>{t('lgpd.external.empty')}</td></tr>
              ) : requests.map((req) => {
                const result = req.result as { conversations_anonymized?: number; messages_redacted?: number };
                return (
                  <tr key={req.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {new Date(req.requested_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>
                      {t('lgpd.requestTypes.external_anonymization')}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={statusBadgeStyle(req.status)}>{req.status}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)', fontSize: 11 }}>
                      {result.conversations_anonymized != null
                        ? t('lgpd.external.resultSummary', {
                            conversations: result.conversations_anonymized,
                            messages: result.messages_redacted ?? 0,
                          })
                        : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--txt-2)' }}>
                      {req.requested_by_name ?? t('tenantAdmin.lgpd.system')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('lgpd.external.total', { count: meta?.total ?? 0 })}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={actionBtnStyle}>{t('lgpd.pagination.prev')}</button>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={Boolean(meta && page >= meta.total_pages)} style={actionBtnStyle}>{t('lgpd.pagination.next')}</button>
          </div>
        </div>
      </section>

      {confirmState.open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.64)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>
          <div className="modal-panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><span>{confirmState.title}</span><button className="tb-icon-btn" onClick={() => setConfirmState((s) => ({ ...s, open: false }))}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></button></div>
            <div className="modal-body"><p style={{ fontSize: 13, color: 'var(--txt-2)', margin: 0 }}>{confirmState.message}</p></div>
            <div className="modal-footer">
              <button className="tb-btn" onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>{t('tenantAdmin.common.cancel')}</button>
              <button className="tb-btn-primary" style={{ background: 'var(--red)', color: '#fff' }} onClick={() => { confirmState.onConfirm(); setConfirmState((s) => ({ ...s, open: false })); }}>{t('tenantAdmin.common.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function Lgpd() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<ActiveTab>('contacts');
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState(180);

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

  const saveRetentionMutation = useMutation({
    mutationFn: () => adminApi.updateSettings({ lgpd_retention_enabled: retentionEnabled, lgpd_retention_days: retentionDays }),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.lgpd.messages.retentionSaved'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const tabBtnStyle = (active: boolean) => ({
    border: 'none',
    background: 'none',
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--txt)' : 'var(--txt-3)',
    cursor: 'pointer',
    borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
    transition: 'color 0.15s',
  });

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
        <header>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--txt)', letterSpacing: '-0.4px' }}>
            {t('lgpd.title')}
          </h1>
          <p style={{ marginTop: 6, color: 'var(--txt-2)', fontSize: 13 }}>{t('lgpd.subtitle')}</p>
        </header>

        {/* SLA dashboard */}
        <LgpdDashboard />

        {/* Retention settings */}
        <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 16 }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('lgpd.retention.title')}</h2>
          <p style={{ marginTop: 6, marginBottom: 12, color: 'var(--txt-2)', fontSize: 12 }}>{t('lgpd.retention.subtitle')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--txt-2)', fontSize: 12 }}>
              <input type="checkbox" checked={retentionEnabled} onChange={(e) => setRetentionEnabled(e.target.checked)} />
              {t('lgpd.retention.enabled')}
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--txt-2)', fontSize: 12 }}>
              {t('lgpd.retention.days')}
              <input
                type="number" min={1} max={3650} value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value || 180))}
                style={{ width: 96, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', color: 'var(--txt)', padding: '6px 8px', fontSize: 12 }}
              />
            </label>
            <button
              type="button"
              onClick={() => saveRetentionMutation.mutate()}
              disabled={saveRetentionMutation.isPending}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
              style={{ border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', borderRadius: 'var(--r)', fontWeight: 600, fontSize: 12, padding: '6px 12px', cursor: 'pointer' }}
            >
              {saveRetentionMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
            </button>
          </div>
        </section>

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid var(--line)', marginBottom: -16 }}>
          <button type="button" style={tabBtnStyle(activeTab === 'contacts')} onClick={() => setActiveTab('contacts')}>
            {t('lgpd.tabs.contacts')}
          </button>
          <button type="button" style={tabBtnStyle(activeTab === 'users')} onClick={() => setActiveTab('users')}>
            {t('lgpd.tabs.users')}
          </button>
          <button type="button" style={tabBtnStyle(activeTab === 'external')} onClick={() => setActiveTab('external')}>
            {t('lgpd.tabs.external')}
          </button>
        </div>

        {activeTab === 'contacts' && <ContactsTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'external' && <ExternalRequestsTab />}
      </div>
    </PageShell>
  );
}
