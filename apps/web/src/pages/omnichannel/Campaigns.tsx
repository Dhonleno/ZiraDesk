import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/layout/PageShell';
import { campaignsApi, type Campaign, type CampaignStatus } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { CampaignCreateModal } from '../../components/omnichannel/CampaignCreateModal';
import { CampaignContactsModal } from '../../components/omnichannel/CampaignContactsModal';
import { CampaignLaunchModal } from '../../components/omnichannel/CampaignLaunchModal';

type StatusFilter = CampaignStatus | '';

const STATUS_COLORS: Record<CampaignStatus, { bg: string; color: string; border: string }> = {
  draft:     { bg: 'var(--bg-4)',   color: 'var(--txt-2)',  border: 'var(--line-2)' },
  scheduled: { bg: 'rgba(96,165,250,.12)', color: 'var(--blue)', border: 'rgba(96,165,250,.25)' },
  running:   { bg: 'var(--teal-dim)', color: 'var(--teal)', border: 'rgba(0,201,167,.25)' },
  paused:    { bg: 'rgba(245,158,11,.1)', color: 'var(--amber)', border: 'rgba(245,158,11,.25)' },
  completed: { bg: 'rgba(62,207,142,.1)', color: 'var(--green)', border: 'rgba(62,207,142,.25)' },
  cancelled: { bg: 'rgba(248,113,113,.1)', color: 'var(--red)', border: 'rgba(248,113,113,.25)' },
};

function StatusPill({ status, failedCount = 0 }: { status: CampaignStatus; failedCount?: number }) {
  const { t } = useTranslation('campaigns');
  const completedWithFailures = status === 'completed' && failedCount > 0;
  const c = completedWithFailures
    ? { bg: 'var(--amber-dim)', color: 'var(--amber)', border: 'rgba(245,158,11,.25)' }
    : STATUS_COLORS[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 'var(--r-pill)',
      border: `1px solid ${c.border}`,
      background: c.bg,
      color: c.color,
      fontSize: 10,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      letterSpacing: '0.03em',
    }}>
      {completedWithFailures ? (
        <span title={t('status.completedWithFailuresDetail', { count: failedCount })}>
          {t('status.completedWithFailuresShort')}
        </span>
      ) : t(`status.${status}` as any)}
    </span>
  );
}

function formatDate(str: string | null | undefined): string {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const FILTERS: { value: StatusFilter; labelKey: string }[] = [
  { value: '', labelKey: 'status.all' },
  { value: 'draft', labelKey: 'status.draft' },
  { value: 'scheduled', labelKey: 'status.scheduled' },
  { value: 'running', labelKey: 'status.running' },
  { value: 'paused', labelKey: 'status.paused' },
  { value: 'completed', labelKey: 'status.completed' },
  { value: 'cancelled', labelKey: 'status.cancelled' },
];

const COL = 'minmax(0,2fr) 130px 72px 70px 70px 62px 68px 110px minmax(120px,1fr) 80px';

export function CampaignsPage() {
  const { t } = useTranslation('campaigns');
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [contactsCampaign, setContactsCampaign] = useState<Campaign | null>(null);
  const [launchCampaign, setLaunchCampaign] = useState<Campaign | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; message: string; onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const openConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmState({ open: true, title, message, onConfirm });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', statusFilter, page],
    queryFn: () => campaignsApi.list({ ...(statusFilter ? { status: statusFilter } : {}), page, limit: 25 }),
    staleTime: 15_000,
  });

  const { data: stats } = useQuery({
    queryKey: ['campaigns-stats'],
    queryFn: () => campaignsApi.stats(),
    staleTime: 15_000,
  });

  const campaigns = data?.data ?? [];
  const meta = data?.meta;
  const total = meta?.total ?? 0;

  // KPIs — sourced from /stats to reflect all campaigns, not just the current page
  const kpiRunning = stats?.running ?? 0;
  const kpiCompleted = stats?.completed ?? 0;
  const avgDelivery = stats?.avg_delivery_rate ?? 0;

  const pauseMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.pause(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Campanha pausada.'); },
    onError: () => toast.error('Erro ao pausar campanha.'),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.resume(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campanha retomada.');
    },
    onError: () => toast.error('Erro ao retomar campanha.'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.cancel(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Campanha cancelada.'); },
    onError: () => toast.error('Erro ao cancelar campanha.'),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.duplicate(id),
    onSuccess: (dup) => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(`Campanha duplicada: "${dup.name}"`);
    },
    onError: () => toast.error('Erro ao duplicar campanha.'),
  });

  const handleExportCsvFromList = async (id: string, name: string) => {
    try {
      const blob = await campaignsApi.exportCsv(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `campanha-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('exportError'));
    }
  };

  const headerCell: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--txt-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const dataCell: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--txt-2)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  return (
    <PageShell padding={0}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: 'var(--bg-2)' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)', margin: 0 }}>{t('title')}</h1>
          <span style={{ fontSize: 10, color: 'var(--txt-3)', background: 'var(--bg-4)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-pill)', padding: '2px 7px', fontWeight: 500 }}>
            {total}
          </span>
        </div>
        <button className="tb-btn tb-btn-primary" onClick={() => setShowCreate(true)}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {t('new')}
        </button>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '12px 20px', flexShrink: 0, background: 'var(--bg-2)', borderBottom: '1px solid var(--line)' }}>
        {[
          { label: t('kpi.total'), value: total, color: 'var(--txt)' },
          { label: t('kpi.running'), value: kpiRunning, color: 'var(--teal)' },
          { label: t('kpi.completed'), value: kpiCompleted, color: 'var(--green)' },
          { label: t('kpi.deliveryRate'), value: `${avgDelivery}%`, color: 'var(--blue)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--mono)', lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Status filter */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 4, flexShrink: 0, overflowX: 'auto' }}>
        {FILTERS.map(({ value, labelKey }) => (
          <button
            key={value}
            type="button"
            onClick={() => { setStatusFilter(value); setPage(1); }}
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: '4px 10px',
              borderRadius: 'var(--r-pill)',
              border: `1px solid ${statusFilter === value ? 'rgba(0,201,167,.3)' : 'var(--line-2)'}`,
              background: statusFilter === value ? 'var(--teal-dim)' : 'transparent',
              color: statusFilter === value ? 'var(--teal)' : 'var(--txt-2)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all .12s',
            }}
          >
            {t(labelKey as any)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: COL, gap: 0, padding: '0 20px', background: 'var(--bg-3)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.name')}</div>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.status')}</div>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.contacts')}</div>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.sent')}</div>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.delivered')}</div>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.read')}</div>
          <div title={t('table.replied')} style={{ ...headerCell, padding: '8px 6px' }}>
            {t('table.repliedShort')}
          </div>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.createdBy')}</div>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.scheduled')}</div>
          <div style={{ ...headerCell, padding: '8px 6px' }}>{t('table.actions')}</div>
        </div>

        {isLoading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt-3)', fontSize: 12 }}>Carregando...</div>
        )}

        {!isLoading && campaigns.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 60 }}>
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden style={{ opacity: 0.3 }}>
              <path d="M6 14c0-4.4 3.6-8 8-8h16c4.4 0 8 3.6 8 8v8c0 5-4 9.5-9 11l-5 3-5-3C9.6 31.5 6 27 6 22v-8z" stroke="var(--txt)" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M14 18h16M14 24h10" stroke="var(--txt)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt-2)' }}>{t('empty.title')}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', textAlign: 'center', maxWidth: 280 }}>{t('empty.description')}</div>
            <button className="tb-btn tb-btn-primary" onClick={() => setShowCreate(true)}>{t('empty.action')}</button>
          </div>
        )}

        {campaigns.map((campaign) => {
          const isHovered = hoveredRow === campaign.id;
          const canPause = campaign.status === 'running';
          const canResume = campaign.status === 'paused';
          const canCancel = ['draft', 'scheduled', 'running', 'paused'].includes(campaign.status);
          const dateStr = campaign.started_at ?? campaign.scheduled_at;

          return (
            <div
              key={campaign.id}
              onMouseEnter={() => setHoveredRow(campaign.id)}
              onMouseLeave={() => setHoveredRow(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: COL,
                gap: 0,
                padding: '0 20px',
                borderBottom: '1px solid var(--line)',
                background: isHovered ? 'var(--bg-3)' : 'transparent',
                transition: 'background .1s',
                minHeight: 40,
                alignItems: 'center',
              }}
            >
              {/* Name */}
              <div
                style={{ ...dataCell, color: 'var(--txt)', fontWeight: 500, cursor: 'pointer', padding: '10px 6px 10px 0', display: 'flex', alignItems: 'center' }}
                onClick={() => navigate(`/omnichannel/campaigns/${campaign.id}`)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {campaign.name}
                </span>
                {campaign.failed_count > 0 && (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--amber)"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, marginLeft: 6 }}
                    role="img"
                    aria-label={t('failedContacts', { count: campaign.failed_count })}
                  >
                    <title>{t('failedContacts', { count: campaign.failed_count })}</title>
                    <path d="M8 2L14 13H2L8 2z" />
                    <line x1="8" y1="7" x2="8" y2="9.5" />
                    <line x1="8" y1="11" x2="8.01" y2="11" />
                  </svg>
                )}
              </div>

              {/* Status */}
              <div style={{ padding: '0 6px', overflow: 'hidden' }}>
                <StatusPill status={campaign.status} failedCount={campaign.failed_count} />
              </div>

              {/* Contacts */}
              <div style={{ ...dataCell, padding: '0 6px', fontFamily: 'var(--mono)' }}>{campaign.total_contacts}</div>

              {/* Sent */}
              <div style={{ ...dataCell, padding: '0 6px', fontFamily: 'var(--mono)' }}>
                {campaign.sent_count}
              </div>

              {/* Delivered */}
              <div style={{ ...dataCell, padding: '0 6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--txt)' }}>
                    {campaign.delivered_count}
                  </span>
                  {campaign.sent_count > 0 && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-3)' }}>
                      {Math.round((campaign.delivered_count / campaign.sent_count) * 100)}%
                    </span>
                  )}
                </div>
              </div>

              {/* Read */}
              <div style={{ ...dataCell, padding: '0 6px', fontFamily: 'var(--mono)', color: 'var(--blue)' }}>
                {campaign.read_count}
              </div>

              {/* Replied */}
              <div style={{ ...dataCell, padding: '0 6px', fontFamily: 'var(--mono)', color: 'var(--teal)' }}>
                {campaign.replied_count}
              </div>

              {/* Created by */}
              <div
                style={{ ...dataCell, padding: '0 6px' }}
                title={campaign.created_by_name ?? '—'}
              >
                {campaign.created_by_name ?? '—'}
              </div>

              {/* Date */}
              <div style={{ ...dataCell, padding: '0 6px', fontSize: 11 }}>{formatDate(dateStr)}</div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 2, alignItems: 'center', padding: '0 0 0 6px', opacity: isHovered ? 1 : 0, transition: 'opacity .12s' }}>
                {/* View */}
                <button
                  className="tb-icon-btn"
                  title={t('actions.view')}
                  onClick={() => navigate(`/omnichannel/campaigns/${campaign.id}`)}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                    <circle cx="6.5" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M1 6.5S3 2 6.5 2s5.5 4.5 5.5 4.5S9 11 6.5 11 1 6.5 1 6.5z" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </button>

                {/* Duplicate */}
                <button
                  className="tb-icon-btn"
                  title={t('actions.duplicate')}
                  disabled={duplicateMutation.isPending}
                  onClick={() => duplicateMutation.mutate(campaign.id)}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                    <rect x="4" y="4" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M2 9V2.5A1.5 1.5 0 013.5 1H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>

                {/* Export CSV */}
                <button
                  className="tb-icon-btn"
                  title={t('exportCsv')}
                  onClick={() => void handleExportCsvFromList(campaign.id, campaign.name)}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                    <path d="M6.5 1.5v6M4 5l2.5 2.5L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2.5 8.5v2h8v-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {/* Launch (draft only) */}
                {campaign.status === 'draft' && (
                  <button
                    className="tb-icon-btn"
                    title={t('actions.launch')}
                    style={{ color: 'var(--teal)' }}
                    onClick={() => setLaunchCampaign(campaign)}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <path d="M2 6.5L11 6.5M7.5 3L11 6.5 7.5 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}

                {/* Pause */}
                {canPause && (
                  <button
                    className="tb-icon-btn"
                    title={t('actions.pause')}
                    disabled={pauseMutation.isPending}
                    onClick={() => pauseMutation.mutate(campaign.id)}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <rect x="2.5" y="2" width="2.5" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
                      <rect x="8" y="2" width="2.5" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                  </button>
                )}

                {/* Resume */}
                {canResume && (
                  <button
                    className="tb-icon-btn"
                    title={t('actions.resume')}
                    disabled={resumeMutation.isPending}
                    onClick={() => resumeMutation.mutate(campaign.id)}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <path d="M3 2.5l7 4-7 4v-8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}

                {/* Cancel */}
                {canCancel && (
                  <button
                    className="tb-icon-btn"
                    title={t('actions.cancel')}
                    disabled={cancelMutation.isPending}
                    style={{ color: 'var(--red)' }}
                    onClick={() => openConfirm(
                      t('actions.cancelTitle'),
                      t('actions.cancelConfirmNamed', { name: campaign.name }),
                      () => cancelMutation.mutate(campaign.id),
                    )}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <path d="M2 2l9 9M11 2L2 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Pagination */}
        {meta && meta.total_pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '14px 20px' }}>
            <button className="tb-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
            <span style={{ fontSize: 11, color: 'var(--txt-3)', alignSelf: 'center' }}>
              {page} / {meta.total_pages}
            </span>
            <button className="tb-btn" disabled={page >= meta.total_pages} onClick={() => setPage((p) => p + 1)}>Próximo</button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CampaignCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(campaign) => {
            setShowCreate(false);
            setContactsCampaign(campaign);
          }}
        />
      )}

      {contactsCampaign && (
        <CampaignContactsModal
          campaign={contactsCampaign}
          onClose={() => setContactsCampaign(null)}
        />
      )}

      {launchCampaign && (
        <CampaignLaunchModal
          campaign={launchCampaign}
          onClose={() => setLaunchCampaign(null)}
          onLaunched={() => setLaunchCampaign(null)}
        />
      )}

      {confirmState.open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.64)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>
          <div className="modal-panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><span>{confirmState.title}</span><button className="tb-icon-btn" onClick={() => setConfirmState((s) => ({ ...s, open: false }))}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></button></div>
            <div className="modal-body"><p style={{ fontSize: 13, color: 'var(--txt-2)', margin: 0 }}>{confirmState.message}</p></div>
            <div className="modal-footer">
              <button className="tb-btn" onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>{t('common.cancel')}</button>
              <button className="tb-btn-primary" style={{ background: 'var(--red)', color: '#fff' }} onClick={() => { confirmState.onConfirm(); setConfirmState((s) => ({ ...s, open: false })); }}>{t('common.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
