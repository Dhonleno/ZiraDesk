import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { subscribeToEvent } from '../../services/socket';

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
  unread_count?: number;
}

type StatusFilter = '' | 'open' | 'in_service' | 'pending' | 'mine' | 'resolved';

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
  onNew?: () => void;
}

export function ConversationList({ selectedId, onSelect, onNew }: Props) {
  const { t } = useTranslation('omnichannel');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [myOnly, setMyOnly] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const qc = useQueryClient();

  useEffect(() => {
    const invalidate = () => void qc.invalidateQueries({ queryKey: ['conversations'] });
    const unsubMessage = subscribeToEvent('conversation:new_message', invalidate);
    const unsubCreated = subscribeToEvent('conversation:created', invalidate);
    return () => {
      unsubMessage?.();
      unsubCreated?.();
    };
  }, [qc]);

  const STATUS_TABS: Array<{ value: StatusFilter; labelKey: string }> = [
    { value: '', labelKey: 'status.all' },
    { value: 'open', labelKey: 'status.open' },
    { value: 'in_service', labelKey: 'status.in_service' },
    { value: 'pending', labelKey: 'status.pending' },
    { value: 'resolved', labelKey: 'status.resolved' },
  ];

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', { status, search: debouncedSearch, myOnly }],
    queryFn: async () => {
      const params = new URLSearchParams({ perPage: '50' });
      if (myOnly || status === 'mine') {
        params.set('assigned_to_me', 'true');
      }
      if (status && status !== 'mine') {
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
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('title')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
            {onNew && (
              <button
                onClick={onNew}
                title={t('new')}
                style={{
                  width: 24, height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--teal)', border: 'none',
                  borderRadius: 'var(--r)', cursor: 'pointer', color: '#0E1A18',
                  transition: 'all .15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
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
            placeholder={t('search')}
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
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-3)', display: 'flex', padding: 0 }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* Meus atendimentos toggle */}
        <button
          onClick={() => setMyOnly((v) => !v)}
          style={{
            marginTop: 8,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: myOnly ? 'var(--teal-dim)' : 'var(--bg-3)',
            border: `1px solid ${myOnly ? 'rgba(0,201,167,.25)' : 'var(--line)'}`,
            borderRadius: 'var(--r)',
            padding: '6px 10px',
            cursor: 'pointer',
            color: myOnly ? 'var(--teal)' : 'var(--txt-3)',
            fontSize: 11,
            fontWeight: 500,
            fontFamily: 'var(--font)',
            transition: 'all .15s',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="6" cy="4" r="2" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M1.5 10c0-2 2-3.5 4.5-3.5s4.5 1.5 4.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            {t('myAttendances')}
          </span>
          {/* Toggle pill */}
          <div style={{
            width: 28, height: 16, borderRadius: 8,
            background: myOnly ? 'var(--teal)' : 'var(--bg-5)',
            position: 'relative', transition: 'background .15s',
          }}>
            <div style={{
              position: 'absolute', top: 2,
              left: myOnly ? 14 : 2,
              width: 12, height: 12, borderRadius: '50%',
              background: myOnly ? '#0E1A18' : 'var(--txt-3)',
              transition: 'left .15s',
            }} />
          </div>
        </button>
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
            {t(tab.labelKey)}
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
                {t('noConversations')}
              </div>
            )
          : (data ?? []).map((conv) => {
              const isActive = selectedId === conv.id;
              const name = conv.client_name ?? 'Visitante';
              const chStyle = CH_STYLE[conv.channel_type];
              const hasUnread = (conv.unread_count ?? 0) > 0;
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
                    boxShadow: isActive ? 'inset 3px 0 0 var(--teal)' : 'none',
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
                      <span style={{
                        fontSize: 13,
                        fontWeight: hasUnread ? 600 : 500,
                        color: 'var(--txt)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 6 }}>
                        {hasUnread && (
                          <div style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: 'var(--teal)',
                            boxShadow: '0 0 0 2px var(--teal-dim)',
                          }} />
                        )}
                        <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
                          {relativeTime(conv.last_message_at ?? conv.created_at)}
                        </span>
                      </div>
                    </div>

                    <p style={{
                      fontSize: 12,
                      color: hasUnread ? 'var(--txt-2)' : 'var(--txt-3)',
                      fontWeight: hasUnread ? 500 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {conv.last_message ?? conv.subject ?? '—'}
                    </p>

                    <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {chStyle && (
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
                      )}
                      {conv.status === 'resolved' && (
                        <span style={{
                          fontSize: 10, fontWeight: 500,
                          padding: '1px 7px', borderRadius: 'var(--r-pill)',
                          background: 'var(--bg-4)', color: 'var(--txt-3)',
                          border: '1px solid var(--line)',
                        }}>
                          {t('status.resolved')}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
      </div>
    </div>
  );
}
