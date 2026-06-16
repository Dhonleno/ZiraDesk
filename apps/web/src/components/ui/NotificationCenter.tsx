import { useMemo, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { notificationsApi, type NotificationItem } from '../../services/api';
import { subscribeToEvent } from '../../services/socket';
import { useToast } from '../../stores/toast.store';

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
  if (type === 'conversation_message') {
    return <path d="M4 14V5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H9l-5 4v-4zM8 8h8M8 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (type === 'message_failed') {
    return <path d="M12 3l9 16H3L12 3zM12 9v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (type === 'ticket_assigned') {
    return <path d="M3 5.5V3h2.5L18 15.5 15.5 18 3 5.5zM5 5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (type === 'conversation_assigned') {
    return <path d="M4 14V5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H9l-5 4v-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />;
  }
  if (type === 'help_requested') {
    return <path d="M12 18v.01M9.2 9.1a2.8 2.8 0 115.6 0c0 2-2.8 2.1-2.8 4.3M12 21a9 9 0 100-18 9 9 0 000 18z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
  }
  return <path d="M5 15l-3 3V5a2 2 0 012-2h13a2 2 0 012 2v8a2 2 0 01-2 2H5zM7 8h8M7 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
}

export function NotificationCenter() {
  const { t } = useTranslation('omnichannel');
  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: notificationsPages, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => notificationsApi.list({ page: pageParam as number, per_page: 20 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.meta.has_more ? lastPage.meta.page + 1 : undefined),
    staleTime: 30_000,
  });

  const backendNotifications = useMemo<NotificationItem[]>(() => {
    const pages = notificationsPages?.pages ?? [];
    const unique = new Map<string, NotificationItem>();
    for (const page of pages) {
      for (const notification of page.data) {
        if (!unique.has(notification.id)) {
          unique.set(notification.id, notification);
        }
      }
    }
    return Array.from(unique.values());
  }, [notificationsPages]);

  const backendUnreadCount = useMemo(
    () => backendNotifications.filter((n) => !n.read).length,
    [backendNotifications],
  );

  const unreadCount = backendUnreadCount;

  const combined = useMemo<NotificationItem[]>(
    () => [...backendNotifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [backendNotifications],
  );

  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllBackend = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const deleteOne = useMutation({
    mutationFn: notificationsApi.deleteOne,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const deleteAllRead = useMutation({
    mutationFn: notificationsApi.deleteAllRead,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(t('notifications.clearReadSuccess'));
    },
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

  function handleMarkAll() {
    markAllBackend.mutate();
  }

  function handleDeleteAllRead() {
    deleteAllRead.mutate();
  }

  function readDataString(data: NotificationItem['data'], key: string): string {
    const value = data?.[key];
    return typeof value === 'string' ? value : '';
  }

  function getSafePreview(notification: NotificationItem): string {
    const rawPreview = readDataString(notification.data, 'preview') || notification.message || '';
    const isNumericPreview = /^\d+$/.test(rawPreview.trim());
    return isNumericPreview ? t('notifications.newMessage') : rawPreview;
  }

  function getNotificationDisplay(notification: NotificationItem): { title: string; preview: string; iconType: NotificationItem['type'] } {
    switch (notification.type) {
      case 'conversation_message': {
        const contactName = readDataString(notification.data, 'contact_name') || 'Cliente';
        const preview = getSafePreview(notification) || t('notifications.newMessage');
        return {
          title: `Nova mensagem de ${contactName}`,
          preview,
          iconType: 'conversation_message',
        };
      }
      case 'conversation_assigned':
        return {
          title: 'Atendimento atribuído a você',
          preview: readDataString(notification.data, 'contact_name') || notification.message || '',
          iconType: 'conversation_assigned',
        };
      case 'message_failed':
        return {
          title: 'Mensagem não entregue',
          preview: readDataString(notification.data, 'reason')
            ? `Falha no envio: ${readDataString(notification.data, 'reason')}`
            : notification.message || '',
          iconType: 'message_failed',
        };
      case 'ticket_assigned':
        return {
          title: 'Ticket atribuído a você',
          preview: readDataString(notification.data, 'title') || notification.message || '',
          iconType: 'ticket_assigned',
        };
      case 'ticket_comment':
        return {
          title: 'Novo comentário no ticket',
          preview: readDataString(notification.data, 'title') || notification.message || '',
          iconType: 'ticket_comment',
        };
      case 'help_requested': {
        const agentName = readDataString(notification.data, 'agent_name');
        return {
          title: 'Pedido de ajuda',
          preview: agentName ? `${agentName} precisa de ajuda` : (notification.message || ''),
          iconType: 'help_requested',
        };
      }
      case 'lgpd_request_received':
        return {
          title: t('notifications.lgpdRequest'),
          preview: readDataString(notification.data, 'subject_label') || notification.message || '',
          iconType: 'lgpd_request_received',
        };
      case 'lgpd_sla_warning':
        return {
          title: t('notifications.lgpdSlaWarning'),
          preview: readDataString(notification.data, 'subject_label') || notification.message || '',
          iconType: 'lgpd_sla_warning',
        };
      case 'lgpd_sla_breached':
        return {
          title: t('notifications.lgpdSlaBreached'),
          preview: readDataString(notification.data, 'subject_label') || notification.message || '',
          iconType: 'lgpd_sla_breached',
        };
      default:
        return {
          title: notification.title || 'Notificação',
          preview: notification.message || '',
          iconType: notification.type,
        };
    }
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
          <div style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <strong style={{ fontSize: 13 }}>Notificações</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={handleMarkAll}
                disabled={unreadCount === 0 || markAllBackend.isPending}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: unreadCount ? 'var(--teal)' : 'var(--txt-3)',
                  fontSize: 11,
                  cursor: unreadCount ? 'pointer' : 'default',
                }}
              >
                {t('notifications.markAllRead')}
              </button>
              <button
                onClick={handleDeleteAllRead}
                disabled={backendUnreadCount === backendNotifications.length || deleteAllRead.isPending}
                title={t('notifications.clearReadHint')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: backendNotifications.some((n) => n.read) ? 'var(--txt-3)' : 'var(--txt-4, var(--txt-3))',
                  fontSize: 11,
                  cursor: backendNotifications.some((n) => n.read) ? 'pointer' : 'default',
                }}
              >
                {t('notifications.clearRead')}
              </button>
            </div>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {combined.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--txt-3)', fontSize: 12 }}>{t('notifications.empty')}</div>
            ) : combined.map((n) => {
              const display = getNotificationDisplay(n);
              return (
                <div
                  key={`backend-${n.id}`}
                  style={{ position: 'relative', borderBottom: '1px solid var(--line)' }}
                  onMouseEnter={() => setHoveredId(n.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <button
                    onClick={() => openBackend(n)}
                    style={{ width: '100%', display: 'flex', gap: 10, padding: '12px 14px', paddingRight: hoveredId === n.id ? 40 : 14, textAlign: 'left', border: 'none', borderBottom: 'none', background: n.read ? 'transparent' : 'var(--teal-dim)', cursor: 'pointer', color: 'var(--txt)' }}
                  >
                    <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-4)', color: 'var(--teal)', flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <BackendNotificationIcon type={display.iconType} />
                      </svg>
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ fontSize: 12 }}>{display.title}</strong>
                        <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{relativeTime(n.created_at)}</span>
                      </span>
                      <span style={{ display: 'block', marginTop: 2, color: 'var(--txt-2)', fontSize: 12, lineHeight: 1.4 }}>{display.preview}</span>
                    </span>
                  </button>
                  {hoveredId === n.id && (
                    <button
                      aria-label="Remover notificação"
                      onClick={(e) => { e.stopPropagation(); deleteOne.mutate(n.id); }}
                      style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-5, var(--bg-4))', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', fontSize: 11, lineHeight: 1 }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {hasNextPage && (
              <button
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '12px',
                  color: 'var(--teal)',
                  background: 'none',
                  border: 'none',
                  borderTop: '1px solid var(--line)',
                  cursor: isFetchingNextPage ? 'default' : 'pointer',
                }}
              >
                {isFetchingNextPage ? 'Carregando...' : t('notifications.loadMore')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
