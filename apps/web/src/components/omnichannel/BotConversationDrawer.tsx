import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  omnichannelApi,
  type MonitorBotConversation as BotConversation,
  type OmnichannelMessage,
} from '../../services/api';

const STUCK_THRESHOLD_MINUTES = 10;

interface Props {
  conversation: BotConversation | null;
  onClose: () => void;
  onPull: (id: string) => void | Promise<boolean | void>;
  onClose_: (id: string) => boolean | void | Promise<boolean | void>;
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  if (safe < 60) return `${safe}min`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${hours}h ${rest}min`;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function isFocusable(element: Element): element is HTMLElement {
  return element instanceof HTMLElement && !element.hasAttribute('disabled') && element.tabIndex !== -1;
}

function messageAlign(message: OmnichannelMessage): 'left' | 'right' | 'system' {
  if (message.sender_type === 'system') return 'system';
  if (message.sender_type === 'bot' || message.sender_type === 'agent') return 'right';
  return 'left';
}

function renderMessageContent(message: OmnichannelMessage): string {
  const text = message.content?.trim();
  if (text) return text;
  return message.content_type ? `[${message.content_type}]` : '-';
}

export function BotConversationDrawer({ conversation, onClose, onPull, onClose_ }: Props) {
  const { t } = useTranslation('omnichannel');
  const [isOpen, setIsOpen] = useState(false);
  const [action, setAction] = useState<'pull' | 'close' | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const liveMinutes = conversation ? minutesSince(conversation.created_at) : 0;
  const isStuck = liveMinutes > STUCK_THRESHOLD_MINUTES;
  const protocol = conversation?.protocol_number ?? conversation?.id.slice(0, 12).toUpperCase() ?? '-';
  const channel = conversation?.channel_name ?? conversation?.channel_type ?? '-';
  const contactName = conversation?.contact_name ?? '-';

  const { data, isFetching } = useQuery({
    queryKey: ['monitor-bot-messages', conversation?.id],
    queryFn: async () => {
      if (!conversation) return { data: [], has_more: false, total: 0 };
      return omnichannelApi.listMessages(conversation.id, { per_page: 80, page: 1 });
    },
    enabled: Boolean(conversation),
    staleTime: 0,
  });

  const messages = useMemo(() => data?.data ?? [], [data?.data]);

  useEffect(() => {
    if (!conversation) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => setIsOpen(true));
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [conversation?.id]);

  useEffect(() => {
    if (!conversation || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button, a[href], textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(isFocusable);
    focusable[0]?.focus();
  }, [conversation?.id]);

  useEffect(() => {
    if (!conversation) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, a[href], textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(isFocusable);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [conversation]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, conversation?.id]);

  if (!conversation) return null;

  function requestClose() {
    setIsOpen(false);
    window.setTimeout(onClose, 200);
  }

  async function handlePull() {
    if (!conversation || action) return;
    setAction('pull');
    const result = await onPull(conversation.id);
    setAction(null);
    if (result !== false) requestClose();
  }

  async function handleCloseConversation() {
    if (!conversation || action) return;
    setAction('close');
    const result = await onClose_(conversation.id);
    setAction(null);
    if (result !== false) requestClose();
  }

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        justifyContent: 'flex-end',
        background: isOpen ? 'var(--backdrop)' : 'transparent',
        transition: 'background 200ms ease-out',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-conversation-drawer-title"
        tabIndex={-1}
        style={{
          width: 'min(420px, 100vw)',
          height: '100vh',
          background: 'var(--bg-2)',
          borderLeft: '1px solid var(--line)',
          boxShadow: 'var(--shadow-pop)',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease-out',
          color: 'var(--txt)',
        }}
      >
        <header
          style={{
            display: 'grid',
            gap: 10,
            padding: 14,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <button
              type="button"
              className="tb-icon-btn"
              onClick={requestClose}
              title={t('monitor.bot.closeDrawer')}
              aria-label={t('monitor.bot.closeDrawer')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong
                id="bot-conversation-drawer-title"
                style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}
              >
                {t('monitor.bot.drawerTitle', { name: contactName })}
              </strong>
              <span
                style={{
                  display: 'block',
                  marginTop: 2,
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--txt-3)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('monitor.bot.drawerSubtitle', { protocol, channel })}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 'var(--r-pill)',
                border: `1px solid ${isStuck ? 'var(--red)' : 'var(--line-2)'}`,
                background: isStuck ? 'var(--red-dim)' : 'var(--bg-3)',
                color: isStuck ? 'var(--red)' : 'var(--txt-2)',
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              {t('monitor.bot.timeInBotLabel')}: <span style={{ fontFamily: 'var(--mono)' }}>{formatDuration(liveMinutes)}</span>
            </span>
            <button
              type="button"
              className="tb-btn tb-btn-primary"
              onClick={() => { void handlePull(); }}
              disabled={Boolean(action)}
            >
              {action === 'pull' ? t('monitor.bot.loading') : t('monitor.bot.pullToQueue')}
            </button>
            <button
              type="button"
              className="tb-btn danger"
              onClick={() => { void handleCloseConversation(); }}
              disabled={Boolean(action)}
            >
              {action === 'close' ? t('monitor.bot.loading') : t('monitor.bot.close')}
            </button>
          </div>
        </header>

        <div
          ref={scrollRef}
          style={{
            minHeight: 0,
            overflowY: 'auto',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {isFetching ? (
            <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('monitor.bot.messagesLoading')}</div>
          ) : null}
          {!isFetching && messages.length === 0 ? (
            <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('monitor.bot.messagesEmpty')}</div>
          ) : null}
          {messages.map((message) => {
            const align = messageAlign(message);
            if (align === 'system') {
              return (
                <div key={message.id} style={{ textAlign: 'center', color: 'var(--txt-3)', fontSize: 11, fontStyle: 'italic' }}>
                  {renderMessageContent(message)}
                  <div style={{ marginTop: 2, fontFamily: 'var(--mono)', fontSize: 10 }}>{formatTime(message.created_at)}</div>
                </div>
              );
            }
            const isRight = align === 'right';
            return (
              <div
                key={message.id}
                style={{
                  display: 'flex',
                  justifyContent: isRight ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '82%',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r)',
                    background: isRight ? 'var(--teal-dim)' : 'var(--bg-3)',
                    padding: '8px 9px',
                    color: 'var(--txt)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <div style={{ fontSize: 12, lineHeight: 1.45 }}>{renderMessageContent(message)}</div>
                  <div
                    style={{
                      marginTop: 5,
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      color: 'var(--txt-3)',
                      textAlign: 'right',
                    }}
                  >
                    {formatTime(message.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <footer
          style={{
            borderTop: '1px solid var(--line)',
            padding: 14,
            display: 'grid',
            gap: 10,
            background: 'var(--bg-2)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <InfoItem label={t('monitor.bot.contact')} value={contactName} />
            <InfoItem label={t('monitor.bot.phone')} value={conversation.contact_whatsapp ?? conversation.contact_phone ?? '-'} />
            <InfoItem label={t('monitor.bot.protocol')} value={protocol} />
            <InfoItem label={t('monitor.bot.channel')} value={channel} />
          </div>
          <button
            type="button"
            className="tb-btn"
            disabled={!conversation.contact_id}
            onClick={() => {
              if (!conversation.contact_id) return;
              window.open(`/crm/contacts?id=${encodeURIComponent(conversation.contact_id)}`, '_blank', 'noopener,noreferrer');
            }}
          >
            {t('monitor.bot.viewFullProfile')}
          </button>
        </footer>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {label}
      </span>
      <strong
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
          color: 'var(--txt)',
          fontWeight: 500,
        }}
      >
        {value}
      </strong>
    </div>
  );
}
