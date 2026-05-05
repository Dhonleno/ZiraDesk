import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, ticketsApi, type Ticket, type TicketStatus, type TicketPriority } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';
import { subscribeToEvent } from '../../services/socket';
import { TicketCard } from '../../components/tickets/TicketCard';
import { CreateTicketModal } from '../../components/tickets/CreateTicketModal';
import { TicketDetail } from './TicketDetail';

/* ── Types ───────────────────────────────────────────────────────────────── */
type StatusTab = TicketStatus | 'all';

interface StatusTabDef {
  key:   StatusTab;
  label: string;
}

/* ── KPI card ─────────────────────────────────────────────────────────────── */
function KpiCard({ label, value, color, loading }: { label: string; value: number | undefined; color: string; loading: boolean }) {
  return (
    <div style={{
      flex: 1, minWidth: 100, padding: '12px 14px', borderRadius: 'var(--r-lg)',
      background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--txt-3)' }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 600, color, fontFamily: 'var(--mono)', lineHeight: 1 }}>
        {loading ? '—' : (value ?? 0)}
      </span>
    </div>
  );
}

/* ── Select style ─────────────────────────────────────────────────────────── */
const selectStyle: React.CSSProperties = {
  background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--txt)',
  height: '2rem', borderRadius: 'var(--r)', padding: '0 0.625rem',
  fontSize: 12, outline: 'none', fontFamily: 'var(--font)', cursor: 'pointer',
};

/* ── Main page ────────────────────────────────────────────────────────────── */
export function TicketsPage() {
  const { t } = useTranslation('tickets');
  const { id: paramId } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);

  const [search, setSearch]           = useState('');
  const [statusTab, setStatusTab]     = useState<StatusTab>('all');
  const [priority, setPriority]       = useState<TicketPriority | ''>('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterSource, setFilterSource] = useState<'' | 'manual' | 'portal' | 'email' | 'whatsapp' | 'api'>('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 300);
  const selectedId = paramId ?? null;
  const contactFilter = searchParams.get('contact_id');

  /* ── Status tabs ── */
  const STATUS_TABS: StatusTabDef[] = [
    { key: 'all',         label: t('tickets.status.all') },
    { key: 'open',        label: t('tickets.status.open') },
    { key: 'in_progress', label: t('tickets.status.in_progress') },
    { key: 'waiting',     label: t('tickets.status.waiting') },
    { key: 'resolved',    label: t('tickets.status.resolved') },
    { key: 'closed',      label: t('tickets.status.closed') },
  ];

  /* ── Queries ── */
  const { data: ticketsData, isPending: listLoading } = useQuery({
    queryKey: ['tickets', debouncedSearch, statusTab, priority, filterAgent, filterSource, contactFilter],
    queryFn: () => {
      const params: import('../../services/api').ListTicketsParams = {
        per_page:   50,
        sort_by:    'created_at',
        sort_order: 'desc',
      };
      if (debouncedSearch)      params.search   = debouncedSearch;
      if (statusTab !== 'all')  params.status   = statusTab;
      if (priority)             params.priority  = priority;
      if (filterAgent)          params.assigned_to = filterAgent;
      if (filterSource)         params.source = filterSource;
      if (contactFilter)        params.contact_id = contactFilter;
      return ticketsApi.list(params);
    },
    staleTime: 30_000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['ticket-filter-agents'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    staleTime: 60_000,
  });

  const { data: stats, isPending: statsLoading } = useQuery({
    queryKey: ['ticket-stats'],
    queryFn: () => ticketsApi.getStats(),
    staleTime: 60_000,
  });

  /* ── Realtime ── */
  useEffect(() => {
    const unsub1 = subscribeToEvent<{ ticket?: Ticket; source?: string; contactName?: string | null; subject?: string | null }>('ticket:created', (data) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-stats'] });
      const source = data?.source ?? data?.ticket?.source ?? 'manual';
      if (source === 'email') {
        const contact = data?.contactName ?? 'Cliente';
        const subject = data?.subject ?? data?.ticket?.title ?? 'Sem assunto';
        toast.info(`📧 ${t('tickets.newFromEmail')}: ${contact} — "${subject}"`);
        return;
      }
      if (source === 'portal') {
        const contact = data?.contactName ?? 'Contato';
        toast.info(`🌐 ${t('tickets.newFromPortal')}: ${contact}`);
        return;
      }
      toast.info(t('tickets.realtime.newTicket'));
    });

    const unsub2 = subscribeToEvent<{ ticket: Ticket }>('ticket:updated', (data) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      if (selectedId === data.ticket.id) {
        void queryClient.invalidateQueries({ queryKey: ['ticket', data.ticket.id] });
      }
    });

    const unsub3 = subscribeToEvent<{ ticket: Ticket }>('ticket:assigned', (data) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      if (data.ticket.assigned_to === user?.id) {
        toast.info(t('tickets.realtime.assignedToYou'));
      }
    });

    return () => { unsub1(); unsub2(); unsub3(); };
  }, [queryClient, toast, user?.id, t, selectedId]);

  const tickets = ticketsData?.data ?? [];
  const total   = ticketsData?.meta.total ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── KPI bar — full width ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
        padding: '12px 16px', borderBottom: '1px solid var(--line)',
        background: 'var(--bg-2)', flexShrink: 0,
      }}>
        <KpiCard label={t('tickets.stats.open')}          value={stats?.open_tickets}        color="var(--blue)"   loading={statsLoading} />
        <KpiCard label={t('tickets.stats.inProgress')}    value={stats?.in_progress_tickets} color="var(--amber)"  loading={statsLoading} />
        <KpiCard label={t('tickets.stats.waiting')}       value={stats?.waiting_tickets}     color="var(--purple)" loading={statsLoading} />
        <KpiCard label={t('tickets.stats.resolvedToday')} value={stats?.resolved_today}      color="var(--green)"  loading={statsLoading} />
      </div>

      {/* ── Panels row ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* ── Left panel ── */}
      <div style={{
        width: 360, minWidth: 300, display: 'flex', flexDirection: 'column',
        borderRight: '1px solid var(--line)', background: 'var(--bg-2)', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--txt)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('tickets.title')}
              <span style={{ fontSize: 11, fontWeight: 500, padding: '1px 7px', borderRadius: 'var(--r-pill)',
                background: 'var(--bg-5)', color: 'var(--txt-3)', fontFamily: 'var(--mono)', border: '1px solid var(--line-2)' }}>
                {total}
              </span>
            </h1>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="zd-btn zd-btn-primary"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {t('tickets.new')}
            </button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <circle cx="5.5" cy="5.5" r="4" stroke="var(--txt-3)" strokeWidth="1.2" />
              <path d="M9 9l2.5 2.5" stroke="var(--txt-3)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Buscar tickets..."
              aria-label="Buscar tickets"
              className="zd-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', height: '2rem',
                paddingLeft: 30, paddingRight: 10, borderRadius: 'var(--r)',
                fontSize: 12,
              }}
            />
          </div>

          {/* Filters row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select aria-label="Filtrar por prioridade" style={{ ...selectStyle, flex: 1 }} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority | '')}>
              <option value="">{t('tickets.priority.all')}</option>
              <option value="low">{t('tickets.priority.low')}</option>
              <option value="medium">{t('tickets.priority.medium')}</option>
              <option value="high">{t('tickets.priority.high')}</option>
              <option value="urgent">{t('tickets.priority.urgent')}</option>
            </select>
            <select
              aria-label="Filtrar por agente"
              style={{ ...selectStyle, flex: 1 }}
              value={filterAgent}
              onChange={(e) => setFilterAgent(e.target.value)}
            >
              <option value="">{t('tickets.filterByAgent')}</option>
              {(agentsData?.data ?? []).map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
            <select
              aria-label="Filtrar por origem"
              style={{ ...selectStyle, flex: 1 }}
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as typeof filterSource)}
            >
              <option value="">{t('tickets.filterBySource')}</option>
              <option value="manual">✏️ {t('tickets.source.manual')}</option>
              <option value="portal">🌐 {t('tickets.source.portal')}</option>
              <option value="email">📧 {t('tickets.source.email')}</option>
              <option value="whatsapp">📱 {t('tickets.source.whatsapp')}</option>
              <option value="api">🔗 API</option>
            </select>
          </div>
        </div>

        {/* Status tabs */}
        <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--line)',
          padding: '0 4px', flexShrink: 0 }}>
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusTab(key)}
              style={{
                padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'var(--font)',
                color: statusTab === key ? 'var(--teal)' : 'var(--txt-3)',
                borderBottom: statusTab === key ? '2px solid var(--teal)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {listLoading && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--txt-3)', fontSize: 13 }}>Carregando...</div>
          )}
          {!listLoading && tickets.length === 0 && (
            <div style={{ padding: 16, minHeight: 260 }}>
              <div className="zd-empty-state">
                <div className="zd-empty-icon" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <rect x="3.5" y="4" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M7 8h8M7 11h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </div>
                <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>{t('tickets.noResults')}</div>
                <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>Ajuste os filtros ou crie um novo ticket.</div>
              </div>
            </div>
          )}
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              selected={ticket.id === selectedId}
              onClick={() => navigate(`/tickets/${ticket.id}`)}
            />
          ))}
        </div>
      </div>

      {/* ── Right panel (detail) ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <TicketDetail ticketId={selectedId} />
      </div>

      </div>

      <CreateTicketModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
}
