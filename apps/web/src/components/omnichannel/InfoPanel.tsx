import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

interface Conversation {
  id: string;
  status: string;
  channel_type: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  assigned_name: string | null;
  channel_name: string | null;
  subject: string | null;
  created_at: string;
  resolved_at: string | null;
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#a18cd1,#fbc2eb)',
];

function avatarGradient(name: string | null) {
  const idx = (name?.charCodeAt(0) ?? 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx] ?? AVATAR_GRADIENTS[0];
}

const CH_BADGE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  whatsapp: { bg: 'rgba(37,211,102,.15)', color: '#25D366', border: 'rgba(37,211,102,.25)', label: 'WhatsApp' },
  email:    { bg: 'var(--blue-dim)',      color: 'var(--blue)', border: 'rgba(96,165,250,.25)', label: 'E-mail' },
  live_chat:{ bg: 'var(--bg-5)',          color: 'var(--txt-2)', border: 'var(--line-2)', label: 'Chat' },
};

const TABS = ['Contato', 'Canais', 'Histórico'] as const;
type Tab = typeof TABS[number];

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: 'var(--txt-3)',
      marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      {children}
      {action}
    </div>
  );
}

function InfoField({
  icon,
  label,
  value,
  empty,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  empty?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '7px 0', borderBottom: '1px solid var(--line)',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: 'var(--bg-4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, color: 'var(--txt-3)',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--txt-3)', marginBottom: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: value ? 'var(--txt)' : 'var(--txt-3)', fontStyle: value ? 'normal' : 'italic' }}>
          {value ?? empty ?? '—'}
        </div>
      </div>
    </div>
  );
}

interface Props {
  conversationId: string;
}

export function InfoPanel({ conversationId }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Contato');

  const { data } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { conversation: Conversation; messages: unknown[] };
      }>(`/omnichannel/conversations/${conversationId}`);
      return res.data.data;
    },
  });

  const conv = data?.conversation;
  const name = conv?.client_name ?? 'Visitante';
  const chBadge = CH_BADGE[conv?.channel_type ?? ''];

  return (
    <div style={{
      width: 300, minWidth: 300,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-2)',
      borderLeft: '1px solid var(--line)',
      overflow: 'hidden',
    }}>
      {/* Header with tabs */}
      <div style={{ padding: '16px 16px 0', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 2, marginBottom: 0 }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: 6,
                borderRadius: 'var(--r)',
                textAlign: 'center',
                fontSize: 11, fontWeight: 500,
                cursor: 'pointer', border: 'none',
                background: activeTab === tab ? 'var(--bg-4)' : 'transparent',
                color: activeTab === tab ? 'var(--txt)' : 'var(--txt-3)',
                transition: 'all .15s',
                marginBottom: 8,
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>

        {activeTab === 'Contato' && (
          <>
            {/* Contact card */}
            <div style={{
              padding: '20px 16px 16px',
              borderBottom: '1px solid var(--line)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              textAlign: 'center', gap: 10,
            }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%',
                background: avatarGradient(conv?.client_name ?? null),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 700, color: '#fff',
                border: '3px solid var(--bg-4)',
              }}>
                {name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>{name}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2 }}>Cliente</div>
              </div>
              {chBadge && (
                <span style={{ padding: '2px 10px', borderRadius: 'var(--r-pill)', fontSize: 10, fontWeight: 500, background: chBadge.bg, color: chBadge.color, border: `1px solid ${chBadge.border}` }}>
                  {chBadge.label}
                </span>
              )}
            </div>

            {/* Stats mini — 4 cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              {([
                { val: '7', lbl: 'Mensagens trocadas' },
                { val: '3', lbl: 'Atendimentos' },
                { val: '22/03', lbl: '1º contato', small: true },
                { val: '↑91%', lbl: 'Engajamento', green: true },
              ] as { val: string; lbl: string; small?: boolean; green?: boolean }[]).map(({ val, lbl, small, green }) => (
                <div key={lbl} style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '10px 12px' }}>
                  <div style={{ fontSize: small ? 14 : green ? 16 : 20, fontWeight: 600, color: green ? 'var(--green)' : 'var(--txt)', letterSpacing: '-0.5px', fontFamily: 'var(--mono)' }}>{val}</div>
                  <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 1 }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* Contact info */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <SectionTitle action={<span style={{ cursor: 'pointer', color: 'var(--teal)', fontSize: 10 }}>Editar</span>}>Informações</SectionTitle>
              <InfoField
                label="E-mail"
                value={conv?.client_email}
                empty="Não informado"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
              <InfoField
                label="Telefone"
                value={conv?.client_phone}
                empty="Não informado"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.22 1.18 2 2 0 012.18 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
            </div>

            {/* Quick actions */}
            <div style={{ padding: '14px 16px' }}>
              <SectionTitle>Ações rápidas</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                {[
                  { label: 'Criar proposta', icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="2" width="9" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><path d="M4 5.5h4M4 7.5h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg> },
                  { label: 'Agendar', icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="2" width="9" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><path d="M1.5 5h9" stroke="currentColor" strokeWidth="1.1"/><path d="M4 1.5v1.5M8 1.5v1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg> },
                  { label: 'Ver tickets', icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1"/><path d="M6 3.5v3l1.5 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg> },
                  { label: 'Ver perfil', icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4.5" r="1.8" stroke="currentColor" strokeWidth="1.1"/><path d="M1.5 10.5c0-2 2-3.5 4.5-3.5s4.5 1.5 4.5 3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg> },
                ].map((a) => (
                  <button
                    key={a.label}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 11, fontWeight: 500, fontFamily: 'var(--font)', cursor: 'pointer', transition: 'all .15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-5)'; e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--txt)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
                  >
                    {a.icon}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'Canais' && (
          <div style={{ padding: '14px 16px' }}>
            <SectionTitle>Canais ativos</SectionTitle>
            <div>
              {[
                { bg: 'rgba(37,211,102,.15)', name: 'WhatsApp', sub: conv?.client_phone ?? '—', time: 'agora', count: '3 msgs', icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10C2.5 12 4.5 13.5 7 13c3-.5 5-3 5-6a5 5 0 10-10 0c0 1.2.4 2.3 1 3.2L2 10z" stroke="#25D366" strokeWidth="1.2" strokeLinejoin="round"/></svg> },
                { bg: 'rgba(244,114,182,.15)', name: 'Instagram DM', sub: '—', time: 'Ontem', count: '1 msg', icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="3" stroke="#F472B6" strokeWidth="1.2"/><circle cx="7" cy="7" r="2.5" stroke="#F472B6" strokeWidth="1.2"/><circle cx="10" cy="4" r=".8" fill="#F472B6"/></svg> },
                { bg: 'rgba(96,165,250,.15)', name: 'E-mail', sub: conv?.client_email ?? '—', time: '22/03', count: '2 msgs', icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3" width="11" height="8.5" rx="1.5" stroke="#60A5FA" strokeWidth="1.2"/><path d="M1.5 5.5l5.5 3.5 5.5-3.5" stroke="#60A5FA" strokeWidth="1.2"/></svg> },
              ].map((ch) => (
                <div key={ch.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: ch.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {ch.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 500 }}>{ch.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--txt-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.sub}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>{ch.time}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, background: 'var(--bg-5)', borderRadius: 'var(--r-pill)', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--txt-2)', marginTop: 2, padding: '0 5px' }}>{ch.count}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Histórico' && (
          <div style={{ padding: '14px 16px' }}>
            <SectionTitle>Atividade recente</SectionTitle>
            <div style={{ position: 'relative', paddingLeft: 18 }}>
              <div style={{ position: 'absolute', left: 6, top: 6, bottom: 6, width: 1, background: 'var(--line-2)' }} />
              {[
                { dot: 'var(--teal)',   label: 'Conversa iniciada',            time: '09:42 hoje' },
                { dot: 'var(--blue)',   label: 'Mensagem enviada pelo agente', time: '09:45 hoje' },
                { dot: 'var(--amber)',  label: 'Aguardando resposta',          time: '09:46 hoje' },
              ].map((ev, i) => (
                <div key={i} style={{ position: 'relative', padding: '6px 0 12px' }}>
                  <div style={{
                    position: 'absolute', left: -16, top: 9,
                    width: 9, height: 9, borderRadius: '50%',
                    background: 'var(--bg-2)', border: `2px solid ${ev.dot}`,
                  }} />
                  <div style={{ fontSize: 12, color: 'var(--txt)' }}>{ev.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)', marginTop: 1 }}>{ev.time}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
