import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';

interface ConversationItem {
  id: string;
  status: string;
  channel_type: string;
  subject: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  client_name: string | null;
  client_email: string | null;
  assigned_name: string | null;
  channel_name: string | null;
}

type StatusFilter = '' | 'open' | 'in_service' | 'mine' | 'resolved';

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'open', label: 'Abertos' },
  { value: 'in_service', label: 'Aguardando' },
  { value: 'mine', label: 'Meus' },
  { value: 'resolved', label: 'Resolvidos' },
];

/* avatar gradient por inicial */
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

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/* channel badge */
const CH_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  whatsapp: {
    bg: 'rgba(37,211,102,.15)',
    color: '#25D366',
    border: 'rgba(37,211,102,.25)',
    label: 'WhatsApp',
  },
  email: {
    bg: 'var(--blue-dim)',
    color: 'var(--blue)',
    border: 'rgba(96,165,250,.25)',
    label: 'E-mail',
  },
  live_chat: {
    bg: 'var(--bg-5)',
    color: 'var(--txt-2)',
    border: 'var(--line-2)',
    label: 'Chat',
  },
};

function ChannelDot({ type }: { type: string }) {
  const s = CH_STYLE[type];
  if (!s) return null;
  return (
    <span
      style={{
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: s.bg,
        border: `2px solid var(--bg-2)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
    </span>
  );
}

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ selectedId, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', { status, search: debouncedSearch }],
    queryFn: async () => {
      const params = new URLSearchParams({ perPage: '50' });
      if (status === 'mine') {
        params.set('assignedToMe', 'true');
      } else if (status) {
        params.set('status', status);
      }
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await api.get<{ success: boolean; data: ConversationItem[] }>(
        `/omnichannel/conversations?${params}`,
      );
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const count = data?.length ?? 0;

  return (
    <div style={{
      width: 280,
      minWidth: 280,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-2)',
      borderRight: '1px solid var(--line)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>Atendimentos</span>
          <span style={{
            background: 'var(--bg-4)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-pill)',
            padding: '2px 8px',
            fontSize: 11,
            fontFamily: 'var(--mono)',
            color: 'var(--txt-2)',
          }}>
            {count}
          </span>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          background: 'var(--bg-3)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r)',
          padding: '7px 10px',
        }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--teal)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--teal-dim)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: 12,
              fontFamily: 'var(--font)',
              color: 'var(--txt)',
              width: '100%',
            }}
          />
        </div>
      </div>

      {/* Status filter tabs */}
      <div style={{
        display: 'flex',
        padding: '8px 14px',
        gap: 4,
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--r-pill)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              border: status === tab.value ? '1px solid rgba(0,201,167,.2)' : '1px solid transparent',
              background: status === tab.value ? 'var(--teal-dim)' : 'transparent',
              color: status === tab.value ? 'var(--teal)' : 'var(--txt-3)',
              transition: 'all .15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin' }}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ height: 12, width: 120, borderRadius: 4, background: 'var(--bg-4)', marginBottom: 8, animation: 'pulse 1.5s ease infinite' }} />
                <div style={{ height: 10, width: 180, borderRadius: 4, background: 'var(--bg-4)', animation: 'pulse 1.5s ease infinite' }} />
              </div>
            ))
          : (data ?? []).length === 0
          ? (
              <div style={{ padding: '48px 16px', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>
                Nenhuma conversa encontrada
              </div>
            )
          : (data ?? []).map((conv) => {
              const isActive = selectedId === conv.id;
              const name = conv.client_name ?? 'Visitante';
              const chStyle = CH_STYLE[conv.channel_type];
              return (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--line)',
                    background: isActive ? 'var(--bg-3)' : 'transparent',
                    boxShadow: isActive ? 'inset 2px 0 0 var(--teal)' : 'none',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-3)'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Avatar + channel dot */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      background: avatarGradient(conv.client_name),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#fff',
                    }}>
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <ChannelDot type={conv.channel_type} />
                  </div>

                  {/* Body */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)', flexShrink: 0, marginLeft: 6 }}>
                        {relativeTime(conv.last_message_at ?? conv.created_at)}
                      </span>
                    </div>

                    <p style={{ fontSize: 12, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.last_message ?? conv.subject ?? '—'}
                    </p>

                    {chStyle && (
                      <div style={{ marginTop: 5 }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 500,
                          padding: '1px 7px',
                          borderRadius: 'var(--r-pill)',
                          background: chStyle.bg,
                          color: chStyle.color,
                          border: `1px solid ${chStyle.border}`,
                        }}>
                          {chStyle.label}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
      </div>
    </div>
  );
}
