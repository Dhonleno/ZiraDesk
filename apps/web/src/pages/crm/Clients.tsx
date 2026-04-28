import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { crmApi } from '../../services/api';
import type { CrmClient } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { CreateClientModal } from '../../components/crm/CreateClientModal';
import { EditClientModal } from '../../components/crm/EditClientModal';
import { ClientProfile } from '../../components/crm/ClientProfile';

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const AVATAR_GRADS = [
  '#667eea,#764ba2', '#f093fb,#f5576c', '#4facfe,#00f2fe', '#43e97b,#38f9d7',
  '#fa709a,#fee140', '#a18cd1,#fbc2eb', '#f7971e,#ffd200', '#5ee7df,#b490ca',
  '#84fab0,#8fd3f4', '#fad0c4,#ffd1ff', '#ee9ca7,#ffdde1', '#fbc2eb,#a6c1ee',
];

function gradFor(id: string): string {
  const h = id.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0);
  return `linear-gradient(135deg,${AVATAR_GRADS[h % AVATAR_GRADS.length]})`;
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => (w[0] ?? '').toUpperCase()).join('');
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(ms / 86_400_000);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  const w = Math.floor(d / 7);
  if (w < 5) return `há ${w} sem`;
  const m = Math.floor(d / 30);
  if (m < 12) return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtLtv(n: number): string {
  if (!n) return '—';
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(1).replace('.', ',')}k`;
  return `R$ ${n.toLocaleString('pt-BR')}`;
}

const KPI_SPARK = [30, 45, 38, 55, 48, 65, 60, 75, 82, 78, 88, 100];

/* Map English backend values → canonical frontend status keys */
const STATUS_NORMALIZE: Record<string, string> = {
  customer:    'cliente',
  client:      'cliente',
  inactive:    'inativo',
  negotiating: 'negociando',
};
function normalizeStatus(s: string): string {
  return STATUS_NORMALIZE[s] ?? s;
}

/* Health score per business rules:
   inactive=20 | email+phone+<7d=100 | email|phone+<30d=70 | else=40 */
function computeHealthScore(c: CrmClient): number {
  if (normalizeStatus(c.status) === 'inativo') return 20;
  const hasEmail = Boolean(c.email);
  const hasPhone = Boolean(c.phone);
  const daysSince = c.last_contact_at
    ? (Date.now() - new Date(c.last_contact_at).getTime()) / 86_400_000
    : Infinity;
  if (hasEmail && hasPhone && daysSince < 7)    return 100;
  if ((hasEmail || hasPhone) && daysSince < 30) return 70;
  return 40;
}

const TAG_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  cliente:    { bg: 'var(--teal-dim)',   color: 'var(--teal)',   border: 'rgba(0,201,167,.25)'   },
  lead:       { bg: 'var(--amber-dim)',  color: 'var(--amber)',  border: 'rgba(245,158,11,.25)'  },
  prospect:   { bg: 'var(--blue-dim)',   color: 'var(--blue)',   border: 'rgba(96,165,250,.25)'  },
  vip:        { bg: 'var(--purple-dim)', color: 'var(--purple)', border: 'rgba(167,139,250,.25)' },
  inativo:    { bg: 'var(--bg-4)',       color: 'var(--txt-3)',  border: 'var(--line-2)'         },
  negociando: { bg: 'var(--pink-dim)',   color: 'var(--pink)',   border: 'rgba(244,114,182,.25)' },
};

const SORT_ICON = (
  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.5 }} aria-hidden>
    <path d="M4.5 1.5v6M2.5 5.5l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ── Sub-components ──────────────────────────────────────────────────────── */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22, marginTop: 2 }}>
      {values.map((h, i) => (
        <div key={i} style={{ flex: 1, height: `${h}%`, background: `linear-gradient(180deg,${color},${color}33)`, borderRadius: 1, opacity: 0.6 }} />
      ))}
    </div>
  );
}

function HealthBar({ value }: { value: number }) {
  const color = value >= 80 ? 'var(--green)' : value >= 50 ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 60, height: 5, background: 'var(--bg-4)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-2)', minWidth: 28 }}>{value}</span>
    </div>
  );
}

function TagPill({ status, label }: { status: string; label: string }) {
  const s = TAG_STYLE[status] ?? TAG_STYLE['inativo']!;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--r-pill)', whiteSpace: 'nowrap', background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {label}
    </span>
  );
}

/* ── CrmClientsPage ──────────────────────────────────────────────────────── */
export function CrmClientsPage() {
  const { t } = useTranslation('crm');
  const [searchParams] = useSearchParams();
  const [searchRaw, setSearchRaw]           = useState('');
  const [segStatus, setSegStatus]           = useState<string | undefined>(undefined);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [page, setPage]                     = useState(1);
  const [selectedId, setSelectedId]         = useState<string | null>(null);
  const [hoveredId, setHoveredId]           = useState<string | null>(null);
  const [editClient, setEditClient]         = useState<CrmClient | null>(null);

  const search = useDebounce(searchRaw, 300);

  useEffect(() => {
    const clientId = searchParams.get('client');
    if (clientId) setSelectedId(clientId);
  }, [searchParams]);

  /* Main list query */
  const { data: listData, isLoading } = useQuery({
    queryKey: ['crm-clients', search, segStatus, page],
    queryFn: () => crmApi.listClients({
      per_page: 20,
      page,
      ...(search    ? { search }         : {}),
      ...(segStatus ? { status: segStatus } : {}),
    }),
  });

  /* KPI count queries — per_page=1 to cheaply get meta.total */
  const { data: kpiClient } = useQuery({
    queryKey: ['crm-kpi', 'client'],
    queryFn: () => crmApi.listClients({ status: 'client', per_page: 1 }),
    staleTime: 60_000,
  });
  const { data: kpiVip } = useQuery({
    queryKey: ['crm-kpi', 'vip'],
    queryFn: () => crmApi.listClients({ status: 'vip', per_page: 1 }),
    staleTime: 60_000,
  });
  const { data: kpiLeads } = useQuery({
    queryKey: ['crm-kpi', 'lead'],
    queryFn: () => crmApi.listClients({ status: 'lead', per_page: 1 }),
    staleTime: 60_000,
  });
  const { data: kpiNeg } = useQuery({
    queryKey: ['crm-kpi', 'negotiating'],
    queryFn: () => crmApi.listClients({ status: 'negotiating', per_page: 1 }),
    staleTime: 60_000,
  });

  const clients    = listData?.data ?? [];
  const meta       = listData?.meta;
  const totalPages = meta?.total_pages ?? 1;

  /* Total ativos = client + vip + negotiating */
  const totalAtivos =
    kpiClient && kpiVip && kpiNeg
      ? kpiClient.meta.total + kpiVip.meta.total + kpiNeg.meta.total
      : undefined;

  /* SEG_TABS: keys are API status values (English), labels are i18n */
  const SEG_TABS: Array<{ key: string | undefined; label: string }> = [
    { key: undefined,       label: t('clients.status.all')        },
    { key: 'client',        label: t('clients.status.cliente')    },
    { key: 'lead',          label: t('clients.status.lead')       },
    { key: 'prospect',      label: t('clients.status.prospect')   },
    { key: 'negotiating',   label: t('clients.status.negociando') },
    { key: 'vip',           label: t('clients.status.vip')        },
    { key: 'inactive',      label: t('clients.status.inativo')    },
  ];

  function handleSegChange(key: string | undefined) {
    setSegStatus(key);
    setPage(1);
  }

  function handleSearch(val: string) {
    setSearchRaw(val);
    setPage(1);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', height: '100%', overflow: 'hidden' }}>

      {/* ── List area ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Page header */}
        <div style={{ padding: '18px 24px 12px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', color: 'var(--txt)' }}>{t('clients.title')}</h1>
          {meta && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt-3)', padding: '3px 9px', borderRadius: 'var(--r-pill)', background: 'var(--bg-3)', border: '1px solid var(--line)' }}>
              {t('clients.total', { n: meta.total.toLocaleString('pt-BR') })}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {[
            { label: t('clients.advancedFilters'), icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 4h8M3.5 7h5M5 10h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg> },
            { label: t('clients.columns'),          icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 6h8M2 3h8M2 9h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg> },
            { label: t('clients.export'),           icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v8M3 6l3 3 3-3M2 11h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg> },
          ].map((b) => (
            <button key={b.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'var(--bg-4)', color: 'var(--txt-2)', fontFamily: 'var(--font)' }}>
              {b.icon}{b.label}
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 2px' }} />
          <button
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'var(--bg-4)', color: 'var(--txt-2)', whiteSpace: 'nowrap', fontFamily: 'var(--font)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2.5 2h7l-.5 4-3 3-3-3-.5-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M2.5 6.5h7" stroke="currentColor" strokeWidth="1.2" /></svg>
            {t('clients.importCsv')}
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', whiteSpace: 'nowrap', fontFamily: 'var(--font)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            {t('clients.newClient')}
          </button>
        </div>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          {[
            { label: t('clients.kpi.totalActive'),   value: totalAtivos,          color: 'var(--teal)'   },
            { label: t('clients.kpi.leadsInFunnel'), value: kpiLeads?.meta.total, color: 'var(--blue)'   },
            { label: t('clients.kpi.inNegotiation'), value: kpiNeg?.meta.total,   color: 'var(--amber)'  },
            { label: t('clients.kpi.avgLtv'),        value: undefined,             color: 'var(--purple)' },
          ].map((kpi) => (
            <div key={kpi.label} style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', fontWeight: 600 }}>{kpi.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', fontFamily: 'var(--mono)', color: 'var(--txt)' }}>
                {kpi.value != null ? kpi.value.toLocaleString('pt-BR') : '—'}
              </div>
              <Sparkline values={KPI_SPARK} color={kpi.color} />
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '7px 11px', flex: 1, maxWidth: 320, minWidth: 200 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--teal)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--teal-dim)'; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
              <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
              <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder={t('clients.searchPlaceholder')}
              value={searchRaw}
              onChange={(e) => handleSearch(e.target.value)}
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--txt)', width: '100%' }}
            />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-3)', padding: '2px 5px', borderRadius: 4, background: 'var(--bg-4)', border: '1px solid var(--line)', flexShrink: 0 }}>⌘K</span>
          </div>
          {(() => {
            const statusActive = segStatus !== undefined;
            const activeTab    = SEG_TABS.find((tab) => tab.key === segStatus);
            const statusLabel  = statusActive
              ? `${t('clients.filters.status')}: ${activeTab?.label ?? segStatus}`
              : t('clients.filters.statusAll');
            return (
              <button
                onClick={() => handleSegChange(undefined)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 'var(--r)', border: statusActive ? '1px solid var(--teal)' : '1px solid var(--line-2)', background: statusActive ? 'var(--teal-dim)' : 'var(--bg-3)', color: statusActive ? 'var(--teal)' : 'var(--txt-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)' }}
              >
                {statusLabel}
                {statusActive
                  ? <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.7 }} aria-hidden><path d="M2 2l5 5M7 2L2 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  : <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.7 }} aria-hidden><path d="M2 3.5l2.5 2.5L7 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                }
              </button>
            );
          })()}
          {[
            t('clients.filters.channel'),
            t('clients.filters.assignedTo'),
            t('clients.filters.tags'),
            t('clients.filters.date'),
          ].map((label) => (
            <button key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)' }}>
              {label}
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.7 }} aria-hidden><path d="M2 3.5l2.5 2.5L7 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 2 }}>
            {[
              { label: t('clients.filters.table'),  active: true,  icon: <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><rect x="1.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" /><path d="M1.5 4h8M1.5 6.5h8M5 1.5v8" stroke="currentColor" strokeWidth="1.2" /></svg> },
              { label: t('clients.filters.kanban'), active: false, icon: <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><rect x="1" y="1.5" width="2.5" height="8" rx=".5" stroke="currentColor" strokeWidth="1.2" /><rect x="4.3" y="1.5" width="2.5" height="6" rx=".5" stroke="currentColor" strokeWidth="1.2" /><rect x="7.5" y="1.5" width="2.5" height="4" rx=".5" stroke="currentColor" strokeWidth="1.2" /></svg> },
            ].map((v) => (
              <div key={v.label} style={{ padding: '5px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5, background: v.active ? 'var(--bg-5)' : 'transparent', color: v.active ? 'var(--txt)' : 'var(--txt-3)' }}>
                {v.icon}{v.label}
              </div>
            ))}
          </div>
        </div>

        {/* Segment tabs */}
        <div style={{ display: 'flex', padding: '0 24px', gap: 2, borderBottom: '1px solid var(--line)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {SEG_TABS.map((tab) => {
            const active = segStatus === tab.key;
            return (
              <button
                key={tab.label}
                onClick={() => handleSegChange(tab.key)}
                style={{ padding: '10px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', color: active ? 'var(--teal)' : 'var(--txt-3)', background: 'transparent', border: 'none', borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', marginBottom: -1, transition: 'all .15s', fontFamily: 'var(--font)' } as React.CSSProperties}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--txt-3)', fontSize: 13 }}>
              {t('clients.loading')}
            </div>
          ) : clients.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: 'var(--txt-3)' }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden><circle cx="16" cy="11" r="6" stroke="currentColor" strokeWidth="1.4" /><path d="M4 28c0-6 5.4-10.5 12-10.5S28 22 28 28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>{t('clients.noClients')}</span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg-2)', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', textAlign: 'left', padding: '10px 14px', width: 36 }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, border: '1.5px solid var(--line-2)', background: 'var(--bg-3)' }} />
                  </th>
                  {[
                    { label: t('clients.table.client'),      sort: true  },
                    { label: t('clients.table.status'),      sort: false },
                    { label: t('clients.table.lastContact'), sort: true  },
                    { label: t('clients.table.ltv'),         sort: true  },
                    { label: t('clients.table.health'),      sort: false },
                    { label: t('clients.table.assignedTo'),  sort: false },
                    { label: '',                             sort: false },
                  ].map((h, i) => (
                    <th key={i} style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg-2)', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', textAlign: 'left', padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      {h.sort ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>{h.label} {SORT_ICON}</span> : h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map((c: CrmClient) => {
                  const isSelected = selectedId === c.id;
                  const isHovered  = hoveredId  === c.id;
                  const grad = gradFor(c.id);
                  const ini  = initials(c.name);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      onMouseEnter={() => setHoveredId(c.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', background: isSelected ? 'rgba(0,201,167,.06)' : isHovered ? 'var(--bg-2)' : 'transparent', transition: 'background .12s' }}
                    >
                      {/* Checkbox */}
                      <td style={{ padding: '10px 14px', width: 36, boxShadow: isSelected ? 'inset 2px 0 0 var(--teal)' : 'none' }}>
                        <div style={{ width: 14, height: 14, borderRadius: 4, border: '1.5px solid var(--line-2)', background: 'var(--bg-3)' }} />
                      </td>

                      {/* Name */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#fff' }}>{ini}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email ?? c.phone ?? '—'}</div>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '10px 14px' }}>
                        <TagPill status={normalizeStatus(c.status)} label={t(`clients.statusLabel.${normalizeStatus(c.status)}`)} />
                      </td>

                      {/* Last contact */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt)' }}>{relTime(c.last_contact_at)}</div>
                        {c.last_contact_at && (
                          <div style={{ fontSize: 10, color: 'var(--txt-3)' }}>
                            {new Date(c.last_contact_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                          </div>
                        )}
                      </td>

                      {/* LTV */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--txt)', fontSize: 12 }}>{fmtLtv(c.ltv)}</div>
                      </td>

                      {/* Health */}
                      <td style={{ padding: '10px 14px' }}><HealthBar value={computeHealthScore(c)} /></td>

                      {/* Owner */}
                      <td style={{ padding: '10px 14px' }}>
                        {c.responsible_name ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 22, height: 22, borderRadius: '50%', background: gradFor(c.responsible_id ?? c.id), flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, color: '#fff' }}>
                              {initials(c.responsible_name)}
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--txt-2)' }}>{c.responsible_name}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>{t('clients.pagination.noOwner')}</span>
                        )}
                      </td>

                      {/* Row actions */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', gap: 4, opacity: isSelected || isHovered ? 1 : 0, transition: 'opacity .12s' }}>
                          <button
                            title={t('clients.actions.chat')}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 8.5V3.5a1 1 0 011-1h6a1 1 0 011 1V7a1 1 0 01-1 1H5l-3 2v-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                          </button>
                          <button
                            title={t('clients.actions.edit')}
                            onClick={(e) => { e.stopPropagation(); setEditClient(c); }}
                            style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                          </button>
                          <button
                            title={t('clients.actions.moreOptions')}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><circle cx="3" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="9" cy="6" r="1" fill="currentColor" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer / pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderTop: '1px solid var(--line)', background: 'var(--bg-2)', flexShrink: 0, fontSize: 12, color: 'var(--txt-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {meta && (
              <>
                <span>
                  {t('clients.pagination.showing')}{' '}
                  <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}>
                    {((meta.page - 1) * meta.per_page + 1).toLocaleString('pt-BR')}–{Math.min(meta.page * meta.per_page, meta.total).toLocaleString('pt-BR')}
                  </strong>
                  {' '}{t('clients.pagination.of')}{' '}
                  <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}>{meta.total.toLocaleString('pt-BR')}</strong>
                </span>
                <span>·</span>
                <span>{meta.per_page} {t('clients.pagination.perPage')}</span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: page <= 1 ? 'var(--txt-3)' : 'var(--txt-2)', cursor: page <= 1 ? 'default' : 'pointer', fontFamily: 'var(--mono)', fontSize: 12, opacity: page <= 1 ? 0.4 : 1 }}
            >
              ←
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{ width: 28, height: 28, borderRadius: 6, background: p === page ? 'var(--teal)' : 'var(--bg-3)', border: p === page ? '1px solid var(--teal)' : '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: p === page ? 'var(--on-teal)' : 'var(--txt-2)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: p === page ? 600 : 400 }}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: page >= totalPages ? 'var(--txt-3)' : 'var(--txt-2)', cursor: page >= totalPages ? 'default' : 'pointer', fontFamily: 'var(--mono)', fontSize: 12, opacity: page >= totalPages ? 0.4 : 1 }}
            >
              →
            </button>
          </div>
        </div>

      </div>{/* end list area */}

      {/* ── Client profile panel ── */}
      <ClientProfile clientId={selectedId} onEdit={setEditClient} />

      {/* ── Modals ── */}
      <CreateClientModal open={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      <EditClientModal client={editClient} onClose={() => setEditClient(null)} />

    </div>
  );
}
