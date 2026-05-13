import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore, type MessageNotification } from '../../stores/notification.store';
import './FloatingChatBubble.css';

type NotificationKind = 'newConversation' | 'newMessage';

interface FloatingChatBubbleProps {
  visible: boolean;
}

const PANEL_EXIT_MS = 100;
const PULSE_DURATION_MS = 2_400;

function formatRelativeTime(isoDate: string, locale: string, nowLabel: string): string {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) return nowLabel;

  const diffMs = Date.now() - timestamp;
  const diffSeconds = Math.floor(diffMs / 1_000);

  if (diffSeconds < 60) return nowLabel;

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return formatter.format(-diffMinutes, 'minute');

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return formatter.format(-diffHours, 'hour');

  const diffDays = Math.floor(diffHours / 24);
  return formatter.format(-diffDays, 'day');
}

function getInitials(name: string): string {
  const clean = name.trim();
  if (clean.length === 0) return '?';
  const pieces = clean.split(/\s+/).filter(Boolean);
  if (pieces.length === 0) return '?';
  if (pieces.length === 1) return (pieces[0]?.slice(0, 2) ?? '?').toUpperCase();
  const first = pieces[0]?.slice(0, 1) ?? '';
  const last = pieces[pieces.length - 1]?.slice(0, 1) ?? '';
  const combined = `${first}${last}`.trim();
  return combined.length > 0 ? combined.toUpperCase() : '?';
}

export function FloatingChatBubble({ visible }: FloatingChatBubbleProps) {
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const { messageNotifications, markConversationRead } = useNotificationStore();

  const [expanded, setExpanded] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [kindsByConversation, setKindsByConversation] = useState<Record<string, NotificationKind>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const previousUnreadRef = useRef(0);
  const seenConversationsRef = useRef<Set<string>>(new Set());

  const orderedNotifications = useMemo(
    () =>
      [...messageNotifications].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [messageNotifications],
  );

  const hasPending = orderedNotifications.length > 0;
  const totalUnread = useMemo(
    () => orderedNotifications.reduce((total, item) => total + item.unreadCount, 0),
    [orderedNotifications],
  );
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'pt-BR';

  useEffect(() => {
    setKindsByConversation((previous) => {
      const next: Record<string, NotificationKind> = {};
      for (const notification of orderedNotifications) {
        const existing = previous[notification.conversationId];
        if (existing) {
          next[notification.conversationId] = existing;
          continue;
        }
        const hasSeenConversation = seenConversationsRef.current.has(notification.conversationId);
        next[notification.conversationId] = hasSeenConversation ? 'newMessage' : 'newConversation';
        seenConversationsRef.current.add(notification.conversationId);
      }
      return next;
    });
  }, [orderedNotifications]);

  useEffect(() => {
    if (totalUnread > previousUnreadRef.current) {
      setPulse(true);
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
      pulseTimerRef.current = window.setTimeout(() => {
        setPulse(false);
        pulseTimerRef.current = null;
      }, PULSE_DURATION_MS);
    }

    if (totalUnread === 0) {
      setPulse(false);
    }

    previousUnreadRef.current = totalUnread;
  }, [totalUnread]);

  useEffect(() => {
    if (visible && hasPending) return;
    setExpanded(false);
    setPanelMounted(false);
    setClosing(false);
  }, [hasPending, visible]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!panelMounted) return undefined;

    const onMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setExpanded(false);
        setClosing(true);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        setClosing(true);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panelMounted]);

  useEffect(() => {
    if (!closing) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setPanelMounted(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, PANEL_EXIT_MS);
  }, [closing]);

  const closePanel = () => {
    if (!panelMounted) return;
    setExpanded(false);
    setClosing(true);
  };

  const openPanel = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (panelMounted) {
      setClosing(false);
      setExpanded(true);
      return;
    }

    setPanelMounted(true);
    setClosing(false);
    window.requestAnimationFrame(() => {
      setExpanded(true);
    });
  };

  const togglePanel = () => {
    if (panelMounted && expanded && !closing) {
      closePanel();
      return;
    }
    openPanel();
  };

  const openConversation = (notification: MessageNotification) => {
    markConversationRead(notification.conversationId);
    closePanel();
    navigate(`/omnichannel/conversations?conversation=${encodeURIComponent(notification.conversationId)}`);
  };

  if (!visible || !hasPending || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div ref={containerRef} className="floating-chat-bubble-root">
      {panelMounted ? (
        <section
          className={`floating-chat-bubble-panel ${closing ? 'floating-chat-bubble-panel--closing' : expanded ? 'floating-chat-bubble-panel--open' : ''}`}
          aria-label={t('floatingBubble.title')}
        >
          <header className="floating-chat-bubble-panel-header">
            <h2 className="floating-chat-bubble-panel-title">{t('floatingBubble.title')}</h2>
            <button
              type="button"
              className="floating-chat-bubble-close-btn"
              onClick={closePanel}
              aria-label={t('cancel')}
              title={t('cancel')}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M3.5 3.5l7 7m0-7l-7 7"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          {orderedNotifications.map((notification) => {
            const kind = kindsByConversation[notification.conversationId] ?? 'newMessage';
            const kindLabel =
              kind === 'newConversation'
                ? t('floatingBubble.newConversation')
                : t('floatingBubble.newMessage');

            return (
              <article key={notification.conversationId} className="floating-chat-bubble-item">
                <div className="floating-chat-bubble-avatar" aria-hidden>
                  {getInitials(notification.contactName)}
                </div>

                <div className="floating-chat-bubble-item-main">
                  <div className="floating-chat-bubble-item-head">
                    <strong className="floating-chat-bubble-contact">{notification.contactName}</strong>
                    <span className="floating-chat-bubble-separator">·</span>
                    <span className="floating-chat-bubble-time">
                      {formatRelativeTime(notification.updatedAt, locale, t('floatingBubble.now'))}
                    </span>
                  </div>

                  <p className="floating-chat-bubble-preview">{notification.lastMessage}</p>

                  <div className="floating-chat-bubble-item-foot">
                    <span
                      className={`floating-chat-bubble-badge ${
                        kind === 'newConversation'
                          ? 'floating-chat-bubble-badge--new-conversation'
                          : 'floating-chat-bubble-badge--new-message'
                      }`}
                    >
                      {kindLabel}
                    </span>

                    <button
                      type="button"
                      className="floating-chat-bubble-open-btn"
                      onClick={() => openConversation(notification)}
                    >
                      {t('floatingBubble.open')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      <button
        type="button"
        className={`floating-chat-bubble-trigger ${pulse ? 'floating-chat-bubble-trigger--pulse' : ''}`}
        onClick={togglePanel}
        aria-label={t('floatingBubble.title')}
        title={t('floatingBubble.title')}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5 6.5h14a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-7l-4.5 3V17H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 10h8M8 13h5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>

        <span className="floating-chat-bubble-counter">
          {totalUnread > 99 ? '99+' : totalUnread}
        </span>
      </button>
    </div>,
    document.body,
  );
}
