import { useRef, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { subscribeToEvent } from '../../services/socket';

interface Message {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  content: string;
  content_type: string;
  status: string;
  is_internal: boolean;
  created_at: string;
}

interface Conversation {
  id: string;
  status: string;
  channel_type: string;
  client_name: string | null;
  assigned_name: string | null;
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

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  open:       { color: 'var(--amber)', bg: 'var(--amber-dim)', border: 'rgba(245,158,11,.25)' },
  in_service: { color: 'var(--teal)',  bg: 'var(--teal-dim)',  border: 'rgba(0,201,167,.25)'  },
  pending:    { color: 'var(--blue)',  bg: 'var(--blue-dim)',  border: 'rgba(96,165,250,.25)' },
  resolved:   { color: 'var(--txt-3)', bg: 'var(--bg-4)',      border: 'var(--line)'           },
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

interface Props {
  conversationId: string;
}

export function ChatArea({ conversationId }: Props) {
  const { t } = useTranslation('omnichannel');
  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [isTyping, _setIsTyping] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { conversation: Conversation; messages: Message[] };
      }>(`/omnichannel/conversations/${conversationId}`);
      return res.data.data;
    },
  });

  useEffect(() => {
    const unsub = subscribeToEvent(
      'conversation:new_message',
      (data: { conversationId: string }) => {
        if (data.conversationId === conversationId) {
          void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
        }
      },
    );
    return unsub;
  }, [conversationId, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) =>
      api.post(`/omnichannel/conversations/${conversationId}/messages`, {
        content: text,
        contentType: 'text',
        isInternal,
      }),
    onSuccess: () => {
      setContent('');
      setIsInternal(false);
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: () => toast.error(t('chat.send') + ' — erro'),
  });

  const resolveMutation = useMutation({
    mutationFn: async () => api.patch(`/omnichannel/conversations/${conversationId}`, { status: 'resolved' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      toast.success(t('chat.resolve') + ' — OK');
    },
    onError: () => toast.error('Erro ao atualizar conversa'),
  });

  function handleSend() {
    const text = content.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  /* auto-resize textarea */
  function handleContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  }

  const conv = data?.conversation;
  const messages = data?.messages ?? [];
  const isResolved = conv?.status === 'resolved';
  const name = conv?.client_name ?? 'Visitante';
  const chBadge = CH_BADGE[conv?.channel_type ?? ''];
  const statusStyle = STATUS_STYLE[conv?.status ?? ''];

  /* group messages by date */
  const grouped: Array<{ date: string; msgs: Message[] }> = [];
  for (const msg of messages) {
    const date = formatDate(msg.created_at);
    const last = grouped[grouped.length - 1];
    if (last && last.date === date) {
      last.msgs.push(msg);
    } else {
      grouped.push({ date, msgs: [msg] });
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* Chat header */}
      <div style={{
        background: 'var(--bg-2)',
        borderBottom: '1px solid var(--line)',
        padding: '0 20px',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexShrink: 0,
      }}>
        {/* Contact info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: avatarGradient(conv?.client_name ?? null),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 600,
            color: '#fff',
            flexShrink: 0,
          }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{name}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              {chBadge && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 7px', borderRadius: 'var(--r-pill)',
                  fontSize: 10, fontWeight: 500,
                  background: chBadge.bg, color: chBadge.color, border: `1px solid ${chBadge.border}`,
                }}>
                  {chBadge.label}
                </span>
              )}
              {statusStyle && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '1px 7px', borderRadius: 'var(--r-pill)',
                  fontSize: 10, fontWeight: 500,
                  background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}`,
                }}>
                  {conv?.status ? t(`status.${conv.status}`, { defaultValue: conv.status }) : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Transferir */}
          <button
            title={t('chat.transfer')}
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 'var(--r)', color: 'var(--txt-3)', cursor: 'pointer', transition: 'all .15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--txt-3)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3l4 4-4 4M13 7H5M1 7h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>

          {/* Silenciar */}
          <button
            title={t('chat.mute')}
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 'var(--r)', color: 'var(--txt-3)', cursor: 'pointer', transition: 'all .15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--txt-3)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4.5 5.5v3M7 4v6M9.5 5.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </button>

          {/* Resolver */}
          {conv && !isResolved && (
            <button
              onClick={() => resolveMutation.mutate()}
              disabled={resolveMutation.isPending}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 'var(--r)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: '1px solid var(--teal)', background: 'var(--teal)', color: '#0E1A18',
                transition: 'all .15s', fontFamily: 'var(--font)',
                opacity: resolveMutation.isPending ? 0.5 : 1,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 6.5l3 3 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {t('chat.resolve')}
            </button>
          )}

          {/* Mais opções */}
          <button
            title={t('chat.more')}
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 'var(--r)', color: 'var(--txt-3)', cursor: 'pointer', transition: 'all .15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--txt-3)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3.5" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="10.5" r="1" fill="currentColor"/></svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--bg-4) transparent',
      }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              border: '2px solid var(--teal)', borderTopColor: 'transparent',
              animation: 'spin 0.7s linear infinite',
            }} />
          </div>
        ) : messages.length === 0 ? (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--txt-3)', padding: '32px 0' }}>
            {t('chat.noMessages')}
          </p>
        ) : (
          grouped.map(({ date, msgs }) => (
            <div key={date}>
              {/* Date divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 8px' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span style={{
                  fontSize: 10, fontWeight: 500, color: 'var(--txt-3)',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  whiteSpace: 'nowrap', fontFamily: 'var(--mono)',
                }}>
                  {date}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>

              {msgs.map((msg) => {
                const isOut = msg.sender_type === 'agent';
                const isSystem = msg.sender_type === 'system';
                if (isSystem) {
                  return (
                    <div key={msg.id} style={{ textAlign: 'center', margin: '8px 0', fontSize: 11, color: 'var(--txt-3)', fontStyle: 'italic' }}>
                      {msg.content}
                    </div>
                  );
                }
                return (
                  <div key={msg.id} style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-end',
                    marginBottom: 4,
                    flexDirection: isOut ? 'row-reverse' : 'row',
                  }}>
                    {/* Mini avatar */}
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: isOut
                        ? 'linear-gradient(135deg,var(--teal),#00A88C)'
                        : avatarGradient(conv?.client_name ?? null),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 600, color: '#fff',
                      flexShrink: 0, marginBottom: 2,
                    }}>
                      {isOut
                        ? (conv?.assigned_name ?? 'A').charAt(0).toUpperCase()
                        : name.charAt(0).toUpperCase()}
                    </div>

                    {/* Bubble */}
                    <div style={{ maxWidth: '62%' }}>
                      <div style={{
                        padding: '9px 13px',
                        borderRadius: 16,
                        borderBottomLeftRadius: isOut ? 16 : 4,
                        borderBottomRightRadius: isOut ? 4 : 16,
                        fontSize: 13,
                        lineHeight: 1.55,
                        wordBreak: 'break-word',
                        background: msg.is_internal
                          ? 'var(--amber-dim)'
                          : isOut ? 'var(--teal)' : 'var(--bg-3)',
                        color: msg.is_internal
                          ? 'var(--amber)'
                          : isOut ? '#0a1a18' : 'var(--txt)',
                        border: msg.is_internal
                          ? '1px solid rgba(245,158,11,.3)'
                          : isOut ? 'none' : '1px solid var(--line)',
                      }}>
                        {msg.is_internal && (
                          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {t('chat.internalNote')}
                          </div>
                        )}
                        {msg.content}
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        marginTop: 4,
                        fontSize: 10,
                        fontFamily: 'var(--mono)',
                        color: 'var(--txt-3)',
                        justifyContent: isOut ? 'flex-end' : 'flex-start',
                      }}>
                        {formatTime(msg.created_at)}
                        {isOut && (
                          <span title={msg.status === 'read' ? t('chat.messageRead') : t('chat.messageDelivered')} style={{ color: msg.status === 'read' ? 'var(--blue)' : 'var(--txt-3)' }}>
                            {msg.status === 'sent' ? (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            ) : (
                              <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden><path d="M1 6l3 3 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 6l3 3 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />

        {/* Typing indicator */}
        {isTyping && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarGradient(conv?.client_name ?? null), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
              {name.charAt(0).toUpperCase()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 12, borderBottomLeftRadius: 4, padding: '8px 12px' }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--txt-3)', animation: `bounce 1.2s ease infinite ${i * 0.2}s` }} />
              ))}
            </div>
            <span style={{ fontSize: 10, color: 'var(--txt-3)', fontStyle: 'italic' }}>{t('chat.typing')}</span>
          </div>
        )}
      </div>

      {/* Quick replies */}
      {!isResolved && (
        <div style={{
          display: 'flex', gap: 6, padding: '0 20px 10px',
          overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0,
        }}>
          {([
            t('chat.sendProposal'),
            t('chat.scheduleCall'),
            t('chat.sendPaymentLink'),
            t('chat.awaitReturn'),
            t('chat.sendContract'),
            t('chat.qualifyLead'),
          ] as string[]).map((r) => (
            <button
              key={r}
              onClick={() => setContent((prev) => prev ? prev + ' ' + r : r)}
              style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '5px 12px', borderRadius: 'var(--r-pill)',
                border: '1px solid var(--line-2)', background: 'var(--bg-3)',
                color: 'var(--txt-2)', fontSize: 12, fontFamily: 'var(--font)',
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-5)'; e.currentTarget.style.borderColor = 'var(--teal)'; e.currentTarget.style.color = 'var(--teal)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{
        background: 'var(--bg-2)',
        borderTop: '1px solid var(--line)',
        padding: '12px 16px',
        flexShrink: 0,
      }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 8 }}>
          {([
            { key: 'b', title: t('chat.bold'), icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M3.5 6.5h4a2 2 0 000-4H3.5v4zM3.5 6.5h4.5a2.5 2.5 0 010 5H3.5V6.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg> },
            { key: 'i', title: t('chat.italic'), icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M5 2.5h5M3 10.5h5M7.5 2.5l-2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
            { key: 'e', title: t('chat.emoji'), icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.2"/><circle cx="4.5" cy="5.5" r=".7" fill="currentColor"/><circle cx="8.5" cy="5.5" r=".7" fill="currentColor"/><path d="M4 8.5c.5 1 3.5 1 4.5 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
            { key: 'a', title: t('chat.attach'), icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M11 6.5L6 11.5a3.5 3.5 0 01-5-5l5.5-5.5a2 2 0 013 3L5 9.5a.5.5 0 01-1-1L9.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
            { key: 'm', title: t('chat.image'), icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><rect x="1.5" y="2.5" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="4.5" cy="5" r="1" fill="currentColor"/><path d="M1.5 8.5l3-3L7 8l2-1.5 2.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
          ] as { key: string; title: string; icon: React.ReactNode }[]).map(({ key, title, icon }) => (
            <button
              key={key}
              disabled={isResolved}
              title={title}
              style={{
                width: 28, height: 28, borderRadius: 'var(--r)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', color: 'var(--txt-3)',
                cursor: isResolved ? 'default' : 'pointer', transition: 'all .15s',
              }}
              onMouseEnter={(e) => { if (!isResolved) { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--txt-2)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--txt-3)'; }}
            >
              {icon}
            </button>
          ))}

          <div style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />

          {/* Respostas rápidas */}
          <button
            disabled={isResolved}
            title={t('chat.quickReplies')}
            style={{ width: 28, height: 28, borderRadius: 'var(--r)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--txt-3)', cursor: isResolved ? 'default' : 'pointer', transition: 'all .15s' }}
            onMouseEnter={(e) => { if (!isResolved) { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--txt-2)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--txt-3)'; }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M2 9V3.5a1 1 0 011-1h7a1 1 0 011 1V7a1 1 0 01-1 1H5l-3 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M4.5 5.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </button>

          {/* Nota interna toggle */}
          <button
            disabled={isResolved}
            onClick={() => setIsInternal((v) => !v)}
            title={t('chat.internalNote')}
            style={{
              width: 28, height: 28, borderRadius: 'var(--r)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isInternal ? 'var(--amber-dim)' : 'none',
              border: isInternal ? '1px solid rgba(245,158,11,.3)' : 'none',
              color: 'var(--amber)', cursor: isResolved ? 'default' : 'pointer', transition: 'all .15s',
            }}
            onMouseEnter={(e) => { if (!isResolved) { e.currentTarget.style.background = isInternal ? 'var(--amber-dim)' : 'var(--bg-4)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = isInternal ? 'var(--amber-dim)' : 'none'; }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M2 9.5L3.5 8l6-6 1.5 1.5-6 6L2 11v-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {/* Input row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            background: isInternal ? 'var(--amber-dim)' : 'var(--bg-3)',
            border: `1px solid ${isInternal ? 'rgba(245,158,11,.3)' : 'var(--line-2)'}`,
            borderRadius: 'var(--r-lg)',
            padding: '10px 12px',
            transition: 'border-color .15s, box-shadow .15s, background .15s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = isInternal ? 'var(--amber)' : 'var(--teal)';
            e.currentTarget.style.boxShadow = isInternal ? '0 0 0 3px var(--amber-dim)' : '0 0 0 3px var(--teal-dim)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = isInternal ? 'rgba(245,158,11,.3)' : 'var(--line-2)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            placeholder={isResolved ? t('chat.resolvedPlaceholder') : isInternal ? t('chat.internalNote') + '...' : t('chat.inputPlaceholder')}
            disabled={isResolved}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: 13,
              fontFamily: 'var(--font)',
              color: isInternal ? 'var(--amber)' : 'var(--txt)',
              resize: 'none',
              minHeight: 20,
              maxHeight: 120,
              lineHeight: 1.5,
              opacity: isResolved ? 0.5 : 1,
            }}
          />
          <button
            onClick={handleSend}
            disabled={!content.trim() || sendMutation.isPending || isResolved}
            style={{
              width: 32, height: 32, borderRadius: 'var(--r)',
              background: isInternal ? 'var(--amber)' : 'var(--teal)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
              color: '#0E1A18',
              transition: 'all .15s',
              opacity: (!content.trim() || sendMutation.isPending || isResolved) ? 0.4 : 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            aria-label={t('chat.send')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Input footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)' }}>
            {content.length > 0
              ? t('chat.charCount', { count: content.length })
              : isInternal
              ? <span style={{ color: 'var(--amber)', fontWeight: 500 }}>{t('chat.internalNoteActive')}</span>
              : t('chat.ctrlEnter')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--txt-3)' }}>
            <span>{t('chat.via')}</span>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'var(--bg-4)', border: '1px solid var(--line)',
              borderRadius: 'var(--r)', padding: '3px 8px',
              cursor: 'pointer', fontSize: 11, color: 'var(--txt-2)',
            }}>
              {conv?.channel_type === 'whatsapp' ? 'WhatsApp' : conv?.channel_type === 'email' ? 'E-mail' : 'Chat'}
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
                <path d="M2 3.5l2.5 2.5L7 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
