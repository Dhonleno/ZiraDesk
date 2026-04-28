import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from '../../services/api';
import type { CrmClient } from '../../services/api';

/* ── Helpers (duplicated from Clients.tsx to keep component self-contained) ── */
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
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

const STATUS_NORMALIZE: Record<string, string> = {
  customer: 'cliente', client: 'cliente', inactive: 'inativo', negotiating: 'negociando',
};
function normalizeStatus(s: string): string { return STATUS_NORMALIZE[s] ?? s; }

const STATUS_LABEL: Record<string, string> = {
  cliente: 'Cliente', lead: 'Lead', prospect: 'Prospect',
  negociando: 'Negociando', vip: 'VIP', inativo: 'Inativo',
};

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  cliente:    { bg: 'var(--teal-dim)',   color: 'var(--teal)',   border: 'rgba(0,201,167,.25)'   },
  lead:       { bg: 'var(--amber-dim)',  color: 'var(--amber)',  border: 'rgba(245,158,11,.25)'  },
  prospect:   { bg: 'var(--blue-dim)',   color: 'var(--blue)',   border: 'rgba(96,165,250,.25)'  },
  vip:        { bg: 'var(--purple-dim)', color: 'var(--purple)', border: 'rgba(167,139,250,.25)' },
  inativo:    { bg: 'var(--bg-4)',       color: 'var(--txt-3)',  border: 'var(--line-2)'         },
  negociando: { bg: 'var(--pink-dim)',   color: 'var(--pink)',   border: 'rgba(244,114,182,.25)' },
};

/* ── Field helper ──────────────────────────────────────────────────────────── */
function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  const empty = !value;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{
        fontSize: mono ? 11 : 12,
        color: empty ? 'var(--txt-3)' : 'var(--txt)',
        fontFamily: mono ? 'var(--mono)' : 'var(--font)',
        fontStyle: empty ? 'italic' : 'normal',
      } as React.CSSProperties}>
        {value || 'Não informado'}
      </span>
    </div>
  );
}

/* ── Props ─────────────────────────────────────────────────────────────────── */
interface Props {
  clientId: string | null;
  onEdit: (client: CrmClient) => void;
}

type Tab = 'dados' | 'timeline' | 'notas';

/* ── ClientProfile ─────────────────────────────────────────────────────────── */
export function ClientProfile({ clientId, onEdit }: Props) {
  const [tab, setTab] = useState<Tab>('dados');

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ['crm-client', clientId],
    queryFn: () => crmApi.getClient(clientId!),
    enabled: !!clientId,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['crm-stats', clientId],
    queryFn: () => crmApi.getClientStats(clientId!),
    enabled: !!clientId,
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: ['crm-timeline', clientId],
    queryFn: () => crmApi.getClientTimeline(clientId!),
    enabled: !!clientId,
  });

  /* Empty state */
  if (!clientId) {
    return (
      <div style={{ background: 'var(--bg-2)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 20px', color: 'var(--txt-3)', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>Nenhum cliente selecionado</div>
        <div style={{ fontSize: 11, maxWidth: 220, lineHeight: 1.5 }}>Clique em um cliente da lista para ver os detalhes</div>
      </div>
    );
  }

  /* Loading state */
  if (clientLoading || !client) {
    return (
      <div style={{ background: 'var(--bg-2)', borderLeft: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--txt-3)' }}>Carregando...</div>
      </div>
    );
  }

  const grad = gradFor(client.id);
  const ini = initials(client.name);
  const norm = normalizeStatus(client.status);
  const tagStyle = STATUS_STYLE[norm] ?? STATUS_STYLE['inativo']!;
  const location = [client.address_city, client.address_state].filter(Boolean).join(', ');
  const typeLabel = client.type === 'company' ? 'Empresa' : 'Pessoa Física';
  const roleDesc = [typeLabel, location].filter(Boolean).join(' · ');

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'dados',    label: 'Dados'    },
    { key: 'timeline', label: 'Timeline' },
    { key: 'notas',    label: 'Notas'    },
  ];

  const tl = (!timelineLoading && timeline && timeline.length > 0) ? timeline : [
    { id: 'empty', type: 'audit' as const, title: 'Sem atividade recente', subtitle: null as string | null, time: client.last_contact_at ?? client.created_at, dot_color: 'var(--txt-3)' },
  ];

  return (
    <div style={{ background: 'var(--bg-2)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <button
          onClick={() => onEdit(client)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--r)', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Editar
        </button>
        <button
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--r)', background: 'var(--teal)', border: '1px solid var(--teal)', color: 'var(--on-teal)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 8.5V3.5a1 1 0 011-1h6a1 1 0 011 1V7a1 1 0 01-1 1H5l-3 2v-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Iniciar conversa
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>

        {/* Hero */}
        <div style={{ padding: '20px 20px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', borderBottom: '1px solid var(--line)', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, background: 'radial-gradient(ellipse at top, rgba(102,126,234,.15), transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 600, color: '#fff', border: '3px solid var(--bg-2)', position: 'relative', zIndex: 1, boxShadow: '0 8px 24px rgba(102,126,234,.3)' }}>
            {ini}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px', color: 'var(--txt)' }}>{client.name}</div>
            {roleDesc && <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2 }}>{roleDesc}</div>}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: tagStyle.bg, color: tagStyle.color, border: `1px solid ${tagStyle.border}` }}>
              {STATUS_LABEL[norm] ?? norm}
            </span>
            {client.tags.slice(0, 4).map((tag) => (
              <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--bg-4)', color: 'var(--txt-2)', border: '1px solid var(--line)' }}>
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* KPI cards */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          {statsLoading ? (
            <div style={{ textAlign: 'center', color: 'var(--txt-3)', fontSize: 12, padding: '8px 0' }}>…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
              {[
                { val: String(stats?.total_conversations ?? 0), lbl: 'Atendimentos' },
                { val: String(stats?.total_messages ?? 0),       lbl: 'Mensagens'   },
                { val: String(stats?.open_tickets ?? 0),          lbl: 'Tickets'     },
                { val: '—',                                        lbl: 'LTV'         },
              ].map(({ val, lbl }) => (
                <div key={lbl} style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '8px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--txt)' }}>{val}</div>
                  <div style={{ fontSize: 9, color: 'var(--txt-3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{lbl}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ flex: 1, padding: '9px 4px', fontSize: 12, fontWeight: 500, cursor: 'pointer', color: tab === t.key ? 'var(--teal)' : 'var(--txt-3)', background: 'transparent', border: 'none', borderBottom: tab === t.key ? '2px solid var(--teal)' : '2px solid transparent', marginBottom: -1, transition: 'all .15s', fontFamily: 'var(--font)' } as React.CSSProperties}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Dados ── */}
        {tab === 'dados' && (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 18 }}>

            <section>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', marginBottom: 10 }}>Contato</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <Field label="E-mail"     value={client.email} />
                <Field label="Telefone"   value={client.phone} mono />
                <Field label="CPF / CNPJ" value={client.document} mono />
                <Field label="Website"    value={client.website} />
              </div>
            </section>

            <section>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', marginBottom: 10 }}>Endereço</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <Field label="CEP"        value={client.address_zip} mono />
                <Field label="Cidade"     value={client.address_city} />
                <div style={{ gridColumn: '1/-1' }}>
                  <Field label="Logradouro" value={client.address_street} />
                </div>
                <Field label="Estado"     value={client.address_state} />
              </div>
            </section>

            <section>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', marginBottom: 10 }}>Dados pessoais</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <Field label="Nascimento" value={client.birth_date ? fmtDate(client.birth_date) : null} />
                <Field label="Gênero"     value={client.gender} />
                <Field label="Ocupação"   value={client.occupation} />
              </div>
            </section>

            <section>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', marginBottom: 10 }}>Comercial</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <Field label="Segmento"  value={client.segment} />
                <Field label="Origem"    value={client.lead_source} />
                <Field label="Atribuído" value={client.responsible_name} />
                <Field label="Desde"     value={fmtDate(client.created_at)} />
              </div>
            </section>

          </div>
        )}

        {/* ── Tab: Timeline ── */}
        {tab === 'timeline' && (
          <div style={{ padding: '14px 16px' }}>
            {timelineLoading ? (
              <div style={{ fontSize: 12, color: 'var(--txt-3)', textAlign: 'center', padding: '20px 0' }}>…</div>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 18 }}>
                <div style={{ position: 'absolute', left: 6, top: 6, bottom: 6, width: 1, background: 'var(--line-2)' }} />
                {tl.map((ev, i) => (
                  <div key={ev.id + i} style={{ position: 'relative', padding: '6px 0 12px' }}>
                    <div style={{ position: 'absolute', left: -16, top: 9, width: 9, height: 9, borderRadius: '50%', background: 'var(--bg-2)', border: `2px solid ${ev.dot_color}` }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--txt)' }}>
                      <span style={{ flex: 1 }}>{ev.title}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-3)', flexShrink: 0 }}>{relTime(ev.time)}</span>
                    </div>
                    {ev.subtitle && (
                      <div style={{ fontSize: 11, color: 'var(--txt-2)', marginTop: 1, lineHeight: 1.5 }}>{ev.subtitle}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Notas ── */}
        {tab === 'notas' && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--txt-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
              <rect x="6" y="4" width="20" height="24" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 10h12M10 15h12M10 20h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>Nenhuma nota registrada</div>
          </div>
        )}

      </div>
    </div>
  );
}
