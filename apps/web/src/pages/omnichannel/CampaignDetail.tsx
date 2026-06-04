import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { PageShell } from '../../components/layout/PageShell';
import { campaignsApi, type Campaign, type CampaignContact, type CampaignContactStatus, type CampaignStatus } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { CampaignContactsModal } from '../../components/omnichannel/CampaignContactsModal';
import { CampaignLaunchModal } from '../../components/omnichannel/CampaignLaunchModal';

const STATUS_COLORS: Record<CampaignStatus, { bg: string; color: string; border: string }> = {
  draft:     { bg: 'var(--bg-4)',   color: 'var(--txt-2)',  border: 'var(--line-2)' },
  scheduled: { bg: 'rgba(96,165,250,.12)', color: 'var(--blue)', border: 'rgba(96,165,250,.25)' },
  running:   { bg: 'var(--teal-dim)', color: 'var(--teal)', border: 'rgba(0,201,167,.25)' },
  paused:    { bg: 'rgba(245,158,11,.1)', color: 'var(--amber)', border: 'rgba(245,158,11,.25)' },
  completed: { bg: 'rgba(62,207,142,.1)', color: 'var(--green)', border: 'rgba(62,207,142,.25)' },
  cancelled: { bg: 'rgba(248,113,113,.1)', color: 'var(--red)', border: 'rgba(248,113,113,.25)' },
};

const CONTACT_STATUS_COLORS: Record<CampaignContactStatus, string> = {
  pending:   'var(--txt-3)',
  sent:      'var(--txt-2)',
  delivered: 'var(--green)',
  read:      'var(--blue)',
  replied:   'var(--teal)',
  failed:    'var(--red)',
  opted_out: 'var(--amber)',
};

function StatusPill({ status }: { status: CampaignStatus }) {
  const { t } = useTranslation('campaigns');
  const c = STATUS_COLORS[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 'var(--r-pill)',
      border: `1px solid ${c.border}`,
      background: c.bg,
      color: c.color,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.03em',
    }}>
      {t(`status.${status}` as any)}
    </span>
  );
}

function fmt(str: string | null | undefined): string {
  if (!str) return '—';
  return new Date(str).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatCampaignDate(str: string | null | undefined): string {
  if (!str) return '—';
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return '—';

  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(date);
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace(/^de\s+/i, '');
  const time = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

  return `${day} ${month}, ${time}`;
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

type ContactFilter = CampaignContactStatus | 'all';

const CONTACT_FILTERS: { value: ContactFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'detail.contacts.filterAll' },
  { value: 'pending', labelKey: 'detail.contacts.filterPending' },
  { value: 'sent', labelKey: 'detail.contacts.filterSent' },
  { value: 'delivered', labelKey: 'detail.contacts.filterDelivered' },
  { value: 'read', labelKey: 'detail.contacts.filterRead' },
  { value: 'replied', labelKey: 'detail.contacts.filterReplied' },
  { value: 'failed', labelKey: 'detail.contacts.filterFailed' },
];

/* ── Delivery funnel bar chart ──────────────────────────────────────── */
function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr) 64px', alignItems: 'center', gap: 10, minHeight: 18 }}>
      <div style={{ fontSize: 11, color: 'var(--txt-3)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ height: 10, background: 'var(--bg-4)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .4s ease' }} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color, fontFamily: 'var(--mono)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {value} <span style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 400 }}>({pct(value, max)}%)</span>
      </div>
    </div>
  );
}

function DetailInfoItem({
  label,
  value,
  mono = false,
  multiline = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div style={{ minWidth: 0, display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', alignItems: multiline ? 'start' : 'baseline', gap: 10 }}>
      <div style={{ color: 'var(--txt-3)', fontSize: 11 }}>{label}</div>
      <div style={{
        color: 'var(--txt)',
        fontSize: 13,
        fontFamily: mono ? 'var(--mono)' : 'var(--font)',
        overflow: multiline ? 'visible' : 'hidden',
        textOverflow: multiline ? 'clip' : 'ellipsis',
        whiteSpace: multiline ? 'normal' : 'nowrap',
        wordBreak: multiline ? 'break-word' : 'normal',
        lineHeight: multiline ? 1.45 : undefined,
      }}>
        {value}
      </div>
    </div>
  );
}

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('campaigns');
  const { t: tOmni } = useTranslation('omnichannel');
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [contactFilter, setContactFilter] = useState<ContactFilter>('all');
  const [contactPage, setContactPage] = useState(1);
  const [showContacts, setShowContacts] = useState(false);
  const [showLaunch, setShowLaunch] = useState(false);

  const { data: campaign, isLoading, error } = useQuery<Campaign>({
    queryKey: ['campaign', id],
    queryFn: () => campaignsApi.get(id!),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const c = query.state.data as Campaign | undefined;
      return c?.status === 'running' ? 30_000 : false;
    },
    enabled: Boolean(id),
  });

  const { data: contactsData } = useQuery({
    queryKey: ['campaign-contacts', id, contactPage],
    queryFn: () => campaignsApi.listContacts(id!, { page: contactPage, limit: 30 }),
    staleTime: 15_000,
    enabled: Boolean(id),
  });

  const { data: reportData } = useQuery({
    queryKey: ['campaign-report', id],
    queryFn: () => campaignsApi.report(id!),
    staleTime: 30_000,
    enabled: Boolean(id),
  });

  useEffect(() => { setContactPage(1); }, [contactFilter]);

  const pauseMutation = useMutation({
    mutationFn: () => campaignsApi.pause(id!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['campaign', id] }); toast.success('Campanha pausada.'); },
    onError: () => toast.error('Erro ao pausar.'),
  });

  const resumeMutation = useMutation({
    mutationFn: () => campaignsApi.resume(id!),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', id] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campanha retomada.');
      if (updated.status === 'running') {
        void queryClient.invalidateQueries({ queryKey: ['campaign', id] });
      }
    },
    onError: () => toast.error('Erro ao retomar.'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => campaignsApi.cancel(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', id] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campanha cancelada.');
    },
    onError: () => toast.error('Erro ao cancelar.'),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => campaignsApi.duplicate(id!),
    onSuccess: (dup) => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(`Campanha duplicada: "${dup.name}"`);
      navigate(`/omnichannel/campaigns/${dup.id}`);
    },
    onError: () => toast.error('Erro ao duplicar.'),
  });

  if (isLoading) {
    return (
      <PageShell padding={24}>
        <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>Carregando...</div>
      </PageShell>
    );
  }

  if (error || !campaign) {
    return (
      <PageShell padding={24}>
        <div style={{ color: 'var(--red)', fontSize: 12 }}>Campanha não encontrada.</div>
      </PageShell>
    );
  }

  const allContacts = contactsData?.data ?? [];
  const filteredContacts: CampaignContact[] = contactFilter === 'all'
    ? allContacts
    : allContacts.filter((cc) => cc.status === contactFilter);
  const contactsMeta = contactsData?.meta;

  const sent = campaign.sent_count;
  const delivered = campaign.delivered_count;
  const read = campaign.read_count;
  const replied = campaign.replied_count;
  const progress = campaign.total_contacts > 0 ? pct(sent, campaign.total_contacts) : 0;

  const dataCell: React.CSSProperties = { fontSize: 11, color: 'var(--txt-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 6px' };
  const contactTableGrid = 'minmax(220px, 2fr) 140px 90px 110px 110px 110px 110px minmax(160px, 1fr)';

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>

        {/* ── Header ── */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', background: 'var(--bg-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {/* Breadcrumb */}
            <Link to="/omnichannel/campaigns" style={{ fontSize: 11, color: 'var(--txt-3)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M7.5 2L4 6l3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('detail.breadcrumb')}
            </Link>
            <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>/</span>
            <h1 style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {campaign.name}
            </h1>
            <StatusPill status={campaign.status} />
          </div>

          {/* Context actions */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {campaign.status === 'draft' && (
              <>
                <button className="tb-btn" onClick={() => setShowContacts(true)}>{t('actions.addContacts')}</button>
                <button className="tb-btn tb-btn-primary" onClick={() => setShowLaunch(true)}>{t('actions.launch')}</button>
              </>
            )}
            {campaign.status === 'running' && (
              <button className="tb-btn" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>{t('actions.pause')}</button>
            )}
            {campaign.status === 'paused' && (
              <>
                <button className="tb-btn tb-btn-primary" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>{t('actions.resume')}</button>
                <button className="tb-btn" style={{ color: 'var(--red)' }} onClick={() => { if (window.confirm('Cancelar campanha?')) cancelMutation.mutate(); }} disabled={cancelMutation.isPending}>{t('actions.cancel')}</button>
              </>
            )}
            {campaign.status === 'scheduled' && (
              <button className="tb-btn" style={{ color: 'var(--red)' }} onClick={() => { if (window.confirm('Cancelar campanha agendada?')) cancelMutation.mutate(); }} disabled={cancelMutation.isPending}>{t('actions.cancel')}</button>
            )}
            {(campaign.status === 'completed' || campaign.status === 'cancelled') && (
              <button className="tb-btn" onClick={() => duplicateMutation.mutate()} disabled={duplicateMutation.isPending}>{t('actions.duplicate')}</button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Campaign details ── */}
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'visible' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 600, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {tOmni('campaigns.detail.info')}
            </div>
            <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 22px', height: 'auto', overflow: 'visible' }}>
              <DetailInfoItem label={tOmni('campaigns.detail.channel')} value={campaign.channel_name ?? '—'} />
              <DetailInfoItem label={tOmni('campaigns.detail.template')} value={campaign.template_name ?? '—'} />
              <DetailInfoItem
                label={tOmni('campaigns.detail.scheduling')}
                value={campaign.scheduled_at ? formatCampaignDate(campaign.scheduled_at) : tOmni('campaigns.detail.immediate')}
                mono={Boolean(campaign.scheduled_at)}
              />
              <DetailInfoItem label={tOmni('campaigns.detail.startedAt')} value={formatCampaignDate(campaign.started_at)} mono />
              <DetailInfoItem label={tOmni('campaigns.detail.completedAt')} value={formatCampaignDate(campaign.completed_at)} mono />
              <DetailInfoItem label={tOmni('campaigns.detail.dailyLimit')} value={tOmni('campaigns.detail.dailyLimitValue', { count: campaign.daily_limit })} />
              <DetailInfoItem label={tOmni('campaigns.detail.notes')} value={campaign.notes?.trim() || '—'} multiline />
            </div>
          </div>

          {/* ── Real-time metrics ── */}
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('detail.metrics.title')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0 }}>
              {[
                { label: t('detail.metrics.sent'), value: sent, sub: `/ ${campaign.total_contacts}`, color: 'var(--txt)', barW: progress },
                { label: t('detail.metrics.delivered'), value: delivered, sub: `${pct(delivered, sent)}%`, color: 'var(--green)', barW: pct(delivered, sent) },
                { label: t('detail.metrics.read'), value: read, sub: `${pct(read, delivered)}%`, color: 'var(--blue)', barW: pct(read, delivered) },
                { label: t('detail.metrics.replied'), value: replied, sub: `${pct(replied, read)}%`, color: 'var(--teal)', barW: pct(replied, read) },
                { label: t('detail.metrics.failed'), value: campaign.failed_count, sub: `${pct(campaign.failed_count, sent)}%`, color: 'var(--red)', barW: pct(campaign.failed_count, sent) },
              ].map(({ label, value, sub, color, barW }, i) => (
                <div key={label} style={{ padding: '14px 16px', borderRight: i < 4 ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--mono)' }}>{value}</span>
                    <span style={{ fontSize: 11, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>{sub}</span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 3, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${barW}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .5s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Delivery funnel ── */}
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'visible' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('detail.funnel.title')}
            </div>
            <div style={{ padding: '12px 20px 14px', display: 'flex', flexDirection: 'column', gap: 8, height: 'auto', overflow: 'visible' }}>
              <FunnelBar label={t('detail.metrics.sent')} value={sent} max={campaign.total_contacts} color="var(--txt-2)" />
              <FunnelBar label={t('detail.metrics.delivered')} value={delivered} max={campaign.total_contacts} color="var(--green)" />
              <FunnelBar label={t('detail.metrics.read')} value={read} max={campaign.total_contacts} color="var(--blue)" />
              <FunnelBar label={t('detail.metrics.replied')} value={replied} max={campaign.total_contacts} color="var(--teal)" />
            </div>
          </div>

          {/* Breakdown by day (if report exists) */}
          {reportData?.breakdown && reportData.breakdown.length > 1 && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Breakdown por dia
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1, background: 'var(--line)' }}>
                  {reportData.breakdown.map((row) => (
                    <div key={row.date} style={{ background: 'var(--bg-2)', padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--txt-3)', marginBottom: 6 }}>{row.date}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {[
                          { label: 'Enviados', v: row.sent, c: 'var(--txt-2)' },
                          { label: 'Entregues', v: row.delivered, c: 'var(--green)' },
                          { label: 'Lidos', v: row.read, c: 'var(--blue)' },
                        ].map(({ label, v, c }) => (
                          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                            <span style={{ color: 'var(--txt-3)' }}>{label}</span>
                            <span style={{ color: c, fontFamily: 'var(--mono)', fontWeight: 600 }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Contacts table ── */}
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('detail.contacts.title')}</span>
              {campaign.status === 'draft' && (
                <button className="tb-btn" style={{ fontSize: 11 }} onClick={() => setShowContacts(true)}>
                  {t('actions.addContacts')}
                </button>
              )}
            </div>

            {/* Contact filter */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 4, overflowX: 'auto' }}>
              {CONTACT_FILTERS.map(({ value, labelKey }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setContactFilter(value)}
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    padding: '3px 8px',
                    borderRadius: 'var(--r-pill)',
                    border: `1px solid ${contactFilter === value ? 'rgba(0,201,167,.3)' : 'var(--line-2)'}`,
                    background: contactFilter === value ? 'var(--teal-dim)' : 'transparent',
                    color: contactFilter === value ? 'var(--teal)' : 'var(--txt-3)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t(labelKey as any)}
                </button>
              ))}
            </div>

            <div style={{ overflow: 'auto', maxHeight: 'min(420px, 48vh)', minHeight: 180, scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>
              <div style={{ minWidth: 1050 }}>
                {/* Table headers */}
                <div style={{ display: 'grid', gridTemplateColumns: contactTableGrid, gap: 0, padding: '0 16px', background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
                  {[t('detail.contacts.colContact'), t('detail.contacts.colPhone'), t('detail.contacts.colStatus'), t('detail.contacts.colSentAt'), t('detail.contacts.colDeliveredAt'), t('detail.contacts.colReadAt'), t('detail.contacts.colRepliedAt'), t('detail.contacts.colError')].map((col) => (
                    <div key={col} style={{ fontSize: 9, fontWeight: 600, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '7px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col}</div>
                  ))}
                </div>

                {filteredContacts.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--txt-3)' }}>
                    {t('detail.contacts.noResults')}
                  </div>
                )}

                {filteredContacts.map((cc) => (
                  <div
                    key={cc.id}
                    style={{ display: 'grid', gridTemplateColumns: contactTableGrid, gap: 0, padding: '0 16px', borderBottom: '1px solid var(--line)', minHeight: 36, alignItems: 'center' }}
                  >
                    <div style={{ ...dataCell, color: 'var(--txt)', fontWeight: 500 }}>{cc.contact_name ?? '—'}</div>
                    <div style={dataCell}>{cc.contact_phone ?? '—'}</div>
                    <div style={{ padding: '0 6px' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: CONTACT_STATUS_COLORS[cc.status] }}>
                        {cc.status}
                      </span>
                    </div>
                    <div style={{ ...dataCell, fontSize: 10 }}>{fmt(cc.sent_at)}</div>
                    <div style={{ ...dataCell, fontSize: 10 }}>{fmt(cc.delivered_at)}</div>
                    <div style={{ ...dataCell, fontSize: 10 }}>{fmt(cc.read_at)}</div>
                    <div style={{ ...dataCell, fontSize: 10 }}>{fmt(cc.replied_at)}</div>
                    <div style={{ ...dataCell, fontSize: 10, color: cc.error_message ? 'var(--red)' : 'var(--txt-3)' }}>
                      {cc.error_message ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pagination */}
            {contactsMeta && contactsMeta.total > 30 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12 }}>
                <button className="tb-btn" disabled={contactPage <= 1} onClick={() => setContactPage((p) => p - 1)} style={{ fontSize: 11 }}>Anterior</button>
                <span style={{ fontSize: 11, color: 'var(--txt-3)', alignSelf: 'center' }}>
                  {(contactPage - 1) * 30 + 1}–{Math.min(contactPage * 30, contactsMeta.total)} de {contactsMeta.total}
                </span>
                <button className="tb-btn" disabled={contactPage * 30 >= contactsMeta.total} onClick={() => setContactPage((p) => p + 1)} style={{ fontSize: 11 }}>Próximo</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showContacts && (
        <CampaignContactsModal
          campaign={campaign}
          onClose={() => {
            setShowContacts(false);
            void queryClient.invalidateQueries({ queryKey: ['campaign', id] });
            void queryClient.invalidateQueries({ queryKey: ['campaign-contacts', id] });
          }}
        />
      )}

      {showLaunch && (
        <CampaignLaunchModal
          campaign={campaign}
          onClose={() => setShowLaunch(false)}
          onLaunched={() => {
            setShowLaunch(false);
            void queryClient.invalidateQueries({ queryKey: ['campaign', id] });
          }}
        />
      )}
    </PageShell>
  );
}
