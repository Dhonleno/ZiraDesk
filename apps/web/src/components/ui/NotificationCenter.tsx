import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { notificationsApi, type NotificationItem } from '../../services/api';
import { subscribeToEvent } from '../../services/socket';

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function NotificationIcon({ type }: { type: NotificationItem['type'] }) {
  if (type === 'ticket_assigned') {
    return <path d="M3 5.5V3h2.5L18 15.5 15.5 18 3 5.5zM5 5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (type === 'conversation_assigned') {
    return <path d="M4 14V5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H9l-5 4v-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />;
  }
  return <path d="M5 15l-3 3V5a2 2 0 012-2h13a2 2 0 012 2v8a2 2 0 01-2 2H5zM7 8h8M7 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
    staleTime: 30_000,
  });

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
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

  function openNotification(notification: NotificationItem) {
    if (!notification.read) markRead.mutate(notification.id);
    setOpen(false);
    navigate(notification.href);
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
            <button onClick={() => markAll.mutate()} disabled={unreadCount === 0 || markAll.isPending} style={{ border: 'none', background: 'transparent', color: unreadCount ? 'var(--teal)' : 'var(--txt-3)', fontSize: 11, cursor: unreadCount ? 'pointer' : 'default' }}>
              Marcar todas como lidas
            </button>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--txt-3)', fontSize: 12 }}>Nenhuma notificação por enquanto</div>
            ) : notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => openNotification(notification)}
                style={{ width: '100%', display: 'flex', gap: 10, padding: '12px 14px', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--line)', background: notification.read ? 'transparent' : 'var(--teal-dim)', cursor: 'pointer', color: 'var(--txt)' }}
              >
                <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-4)', color: 'var(--teal)', flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <NotificationIcon type={notification.type} />
                  </svg>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 12 }}>{notification.title}</strong>
                    <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>{relativeTime(notification.created_at)}</span>
                  </span>
                  <span style={{ display: 'block', marginTop: 2, color: 'var(--txt-2)', fontSize: 12, lineHeight: 1.4 }}>{notification.message}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
