import { useMemo, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { notificationsApi, type NotificationItem } from '../../services/api';
import { subscribeToEvent } from '../../services/socket';
import { useNotificationStore, type MessageNotification } from '../../stores/notification.store';

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#a18cd1,#fbc2eb)',
];

function avatarGradient(name: string): string {
  const idx = (name.charCodeAt(0) ?? 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx] ?? AVATAR_GRADIENTS[0]!;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function BackendNotificationIcon({ type }: { type: NotificationItem['type'] }) {
  if (type === 'ticket_assigned') {
    return <path d="M3 5.5V3h2.5L18 15.5 15.5 18 3 5.5zM5 5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (type === 'conversation_assigned') {
    return <path d="M4 14V5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H9l-5 4v-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />;
  }
  return <path d="M5 15l-3 3V5a2 2 0 012-2h13a2 2 0 012 2v8a2 2 0 01-2 2H5zM7 8h8M7 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
}

type CombinedNotification =
  | { kind: 'message'; time: number; data: MessageNotification }
  | { kind: 'backend'; time: number; data: NotificationItem };

export function NotificationCenter() {
  const { t } = useTranslation('omnichannel');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { messageNotifications, markConversationRead, markAllRead: clearMessages } = useNotificationStore();

  const { data: backendNotifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
    staleTime: 30_000,
  });

  const backendUnreadCount = useMemo(
    () => backendNotifications.filter((n) => !n.read).length,
    [backendNotifications],
  );

  const unreadCount = backendUnreadCount + messageNotifications.length;

  const combined = useMemo<CombinedNotification[]>(() => {
    // Conversations already represented by a frontend message notification.
    const coveredIds = new Set(messageNotifications.map((n) => n.conversationId));

    const extractConvId = (href: string): string | null => {
      try {
        return new URL(href, 'http://x').searchParams.get('conversation');
      } catch {
        return null;
      }
    };

    const messageItems: CombinedNotification[] = messageNotifications.map((n) => ({
      kind: 'message',
      time: new Date(n.updatedAt).getTime(),
      data: n,
    }));

    const backendItems: CombinedNotification[] = backendNotifications
      .filter((n) => {
        const convId = extractConvId(n.href);
        return !(convId && coveredIds.has(convId));
      })
      .map((n) => ({
        kind: 'backend',
        time: new Date(n.created_at).getTime(),
        data: n,
      }));

    return [...messageItems, ...backendItems].sort((a, b) => b.time - a.time);
  }, [messageNotifications, backendNotifications]);

  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllBackend = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    return subscribeToEvent('notification:new', () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    });
  }, [qc]);

  function openBackend(n: NotificationItem) {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    navigate(n.href);
  }

  function openMessage(n: MessageNotification) {
    markConversationRead(n.conversationId);
    // Mark any matching backend notifications as read so they don't resurface.
    backendNotifications
      .filter((bn) => {
        try {
          return new URL(bn.href, 'http://x').searchParams.get('conversation') === n.conversationId;
        } catch {
          return false;
        }
      })
      .filter((bn) => !bn.read)
      .forEach((bn) => markRead.mutate(bn.id));
    setOpen(false);
    navigate(`/omnichannel/conversations?conversation=${n.conversationId}`);
  }

  function handleMarkAll() {
    markAllBackend.mutate();
    clearMessages();
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button className="tb-icon-btn" aria-label="Notificações" onClick={() => setOpen((v) => !v)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M18 9a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 20a2 2 0 004 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unreadCount > 0 && (
          <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 999, background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', right: 0, top: 38, width: 360, maxHeight: 460, overflow: 'hidden', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-pop)', zIndex: 80 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 13 }}>Notificações</strong>
            <button
              onClick={handleMarkAll}
              disabled={unreadCount === 0 || markAllBackend.isPending}
              style={{ border: 'none', background: 'transparent', color: unreadCount ? 'var(--teal)' : 'var(--txt-3)', fontSize: 11, cursor: unreadCount ? 'pointer' : 'default' }}
            >
              {t('notifications.markAllRead')}
            </button>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {combined.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--txt-3)', fontSize: 12 }}>Nenhuma notificação por enquanto</div>
            ) : combined.map((item) => {
              if (item.kind === 'message') {
                const n = item.data;
                const initial = n.contactName.charAt(0).toUpperCase();
                return (
                  <button
                    key={`msg-${n.conversationId}`}
                    onClick={() => openMessage(n)}
                    style={{ width: '100%', display: 'flex', gap: 10, padding: '12px 14px', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--line)', background: 'var(--teal-dim)', cursor: 'pointer', color: 'var(--txt)' }}
                  >
                    <span style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: avatarGradient(n.contactName), color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {initial}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ fontSize: 12 }}>{n.contactName}</strong>
                        <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{relativeTime(n.updatedAt)}</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <span style={{ flex: 1, minWidth: 0, color: 'var(--txt-2)', fontSize: 12, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {n.lastMessage}
                        </span>
                        {n.unreadCount > 1 && (
                          <span style={{ flexShrink: 0, background: 'var(--teal)', color: 'var(--on-teal)', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                            {n.unreadCount} {t('notifications.messages')}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              }

              const n = item.data;
              return (
                <button
                  key={`backend-${n.id}`}
                  onClick={() => openBackend(n)}
                  style={{ width: '100%', display: 'flex', gap: 10, padding: '12px 14px', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--line)', background: n.read ? 'transparent' : 'var(--teal-dim)', cursor: 'pointer', color: 'var(--txt)' }}
                >
                  <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-4)', color: 'var(--teal)', flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <BackendNotificationIcon type={n.type} />
                    </svg>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontSize: 12 }}>{n.title}</strong>
                      <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{relativeTime(n.created_at)}</span>
                    </span>
                    <span style={{ display: 'block', marginTop: 2, color: 'var(--txt-2)', fontSize: 12, lineHeight: 1.4 }}>{n.message}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
