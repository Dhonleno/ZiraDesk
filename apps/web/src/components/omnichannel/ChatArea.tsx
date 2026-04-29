import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { omnichannelApi, type OmnichannelConversation, type OmnichannelMessage } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useAuthStore } from '../../stores/auth.store';
import { subscribeToEvent } from '../../services/socket';
import { ResolveModal } from './ResolveModal';
import { TransferModal } from './TransferModal';
import { MediaUpload, type MediaUploadHandle, type SentMediaPayload } from './MediaUpload';
import { AudioRecorder, type AudioRecorderHandle } from './AudioRecorder';
import { MessageMedia } from './MessageMedia';

type Message = OmnichannelMessage;
type Conversation = OmnichannelConversation;

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
  email: { bg: 'var(--blue-dim)', color: 'var(--blue)', border: 'rgba(96,165,250,.25)', label: 'E-mail' },
  live_chat: { bg: 'var(--bg-5)', color: 'var(--txt-2)', border: 'var(--line-2)', label: 'Chat' },
};

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  open: { color: 'var(--amber)', bg: 'var(--amber-dim)', border: 'rgba(245,158,11,.25)' },
  in_service: { color: 'var(--teal)', bg: 'var(--teal-dim)', border: 'rgba(0,201,167,.25)' },
  pending: { color: 'var(--blue)', bg: 'var(--blue-dim)', border: 'rgba(96,165,250,.25)' },
  resolved: { color: 'var(--txt-3)', bg: 'var(--bg-4)', border: 'var(--line)' },
  closed: { color: 'var(--txt-3)', bg: 'var(--bg-4)', border: 'var(--line)' },
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
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [isTyping, _setIsTyping] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isMessagesLoading, setIsMessagesLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [localMediaUrls, setLocalMediaUrls] = useState<Record<string, string>>({});
  const toast = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaUploadRef = useRef<MediaUploadHandle>(null);
  const audioRecorderRef = useRef<AudioRecorderHandle>(null);
  const lastMessagesErrorAtRef = useRef(0);
  const isLoadingLatestRef = useRef(false);
  const skipNextAutoScrollRef = useRef(false);
  const nextScrollBehaviorRef = useRef<ScrollBehavior>('smooth');
  const localMediaUrlsRef = useRef<Record<string, string>>({});
  const [isMediaActive, setIsMediaActive] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  const registerLocalMediaPreview = useCallback((payload: SentMediaPayload) => {
    setLocalMediaUrls((prev) => {
      const currentForMedia = prev[payload.mediaId];
      if (currentForMedia && currentForMedia !== payload.localPreviewUrl) {
        URL.revokeObjectURL(currentForMedia);
      }
      return {
        ...prev,
        [payload.mediaId]: payload.localPreviewUrl,
      };
    });
  }, []);

  const clearLocalMediaPreviews = useCallback(() => {
    setLocalMediaUrls((prev) => {
      for (const url of Object.values(prev)) {
        URL.revokeObjectURL(url);
      }
      return {};
    });
  }, []);

  useEffect(() => {
    localMediaUrlsRef.current = localMediaUrls;
  }, [localMediaUrls]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(localMediaUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => omnichannelApi.getConversation(conversationId),
  });

  const notifyMessagesLoadError = useCallback(() => {
    const now = Date.now();
    if (now - lastMessagesErrorAtRef.current < 2500) return;
    lastMessagesErrorAtRef.current = now;
    toast.error(t('history.error', { defaultValue: 'Erro ao carregar mensagens' }));
  }, [t, toast]);

  const loadLatestMessages = useCallback(async (preserveOlder: boolean) => {
    if (isLoadingLatestRef.current) return;
    isLoadingLatestRef.current = true;
    setIsMessagesLoading(true);
    try {
      const result = await omnichannelApi.listMessages(conversationId, { per_page: 50, page: 1 });
      setHasMore(result.has_more);
      setTotalMessages(result.total);
      setMessages((prev) => {
        if (!preserveOlder) return result.data;
        const latestIds = new Set(result.data.map((msg) => msg.id));
        const earliestLatest = result.data[0] ? new Date(result.data[0].created_at).getTime() : Number.POSITIVE_INFINITY;
        const olderMessages = prev.filter((msg) => {
          if (latestIds.has(msg.id)) return false;
          return new Date(msg.created_at).getTime() < earliestLatest;
        });
        return [...olderMessages, ...result.data];
      });

    } catch {
      notifyMessagesLoadError();
    } finally {
      isLoadingLatestRef.current = false;
      setIsMessagesLoading(false);
    }
  }, [conversationId, notifyMessagesLoadError]);

  useEffect(() => {
    setContent('');
    setIsInternal(false);
    clearLocalMediaPreviews();
    nextScrollBehaviorRef.current = 'auto';
    void loadLatestMessages(false);
  }, [clearLocalMediaPreviews, conversationId, loadLatestMessages]);

  const latestMessageKey = messages.length
    ? `${messages.length}:${messages[messages.length - 1]?.id ?? ''}`
    : '0';

  useEffect(() => {
    if (!messages.length) return;
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }

    const behavior = nextScrollBehaviorRef.current;
    nextScrollBehaviorRef.current = 'smooth';
    scrollToBottom(behavior);
  }, [latestMessageKey, messages.length, scrollToBottom]);

  useEffect(() => {
    const unsubNew = subscribeToEvent<{ conversationId: string }>('conversation:new_message', (event) => {
      if (event.conversationId !== conversationId) return;
      nextScrollBehaviorRef.current = 'smooth';
      void loadLatestMessages(true);
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });

    const unsubIncoming = subscribeToEvent<{ conversationId: string }>('conversation:message', (event) => {
      if (event.conversationId !== conversationId) return;
      nextScrollBehaviorRef.current = 'smooth';
      void loadLatestMessages(true);
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });

    const unsubResolved = subscribeToEvent<{ conversationId: string }>('conversation:resolved', (event) => {
      if (event.conversationId !== conversationId) return;
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });

    const unsubTransferred = subscribeToEvent<{ conversationId: string }>('conversation:transferred', (event) => {
      if (event.conversationId !== conversationId) return;
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
    });

    return () => {
      unsubNew();
      unsubIncoming();
      unsubResolved();
      unsubTransferred();
    };
  }, [conversationId, loadLatestMessages, qc]);

  const sendMutation = useMutation({
    mutationFn: (payload: { text: string; isInternalMessage: boolean }) =>
      omnichannelApi.sendMessage(conversationId, {
        content: payload.text,
        contentType: 'text',
        isInternal: payload.isInternalMessage,
      }),
    onSuccess: () => {
      setContent('');
      setIsInternal(false);
      nextScrollBehaviorRef.current = 'smooth';
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void loadLatestMessages(true);
    },
    onError: () => toast.error(t('chat.send') + ' — erro'),
  });

  const resolveMutation = useMutation({
    mutationFn: (payload: { csat_score?: number; csat_comment?: string }) =>
      omnichannelApi.resolve(conversationId, payload),
    onSuccess: () => {
      setShowResolveModal(false);
      toast.success(t('resolve.resolved'));
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: () => toast.error(t('resolve.error', { defaultValue: 'Erro ao resolver atendimento' })),
  });

  const closeMutation = useMutation({
    mutationFn: () => omnichannelApi.close(conversationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: () => toast.error(t('chat.closeError', { defaultValue: 'Erro ao fechar atendimento' })),
  });

  const reopenMutation = useMutation({
    mutationFn: () => omnichannelApi.reopen(conversationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: () => toast.error(t('resolve.reopenError', { defaultValue: 'Erro ao reabrir atendimento' })),
  });

  const transferSystemMessage = useMutation({
    mutationFn: (agentName: string) =>
      omnichannelApi.sendMessage(conversationId, {
        content: t('transfer.systemMessage', { name: agentName }),
        contentType: 'text',
        isInternal: true,
      }),
    onSuccess: () => {
      nextScrollBehaviorRef.current = 'smooth';
      void loadLatestMessages(true);
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  async function handleLoadOlder() {
    if (isLoadingMore || !hasMore || messages.length === 0) return;
    const firstMessageId = messages[0]?.id;
    if (!firstMessageId) return;

    const container = messagesContainerRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;

    setIsLoadingMore(true);
    try {
      const result = await omnichannelApi.listMessages(conversationId, {
        per_page: 50,
        before: firstMessageId,
      });
      setHasMore(result.has_more);
      setTotalMessages(result.total);
      skipNextAutoScrollRef.current = true;
      setMessages((prev) => [...result.data, ...prev]);

      window.requestAnimationFrame(() => {
        if (!container) return;
        const heightDiff = container.scrollHeight - previousHeight;
        container.scrollTop = previousTop + heightDiff;
      });
    } catch {
      notifyMessagesLoadError();
    } finally {
      setIsLoadingMore(false);
    }
  }

  function handleSend() {
    if (!canSendMessage) return;
    const text = content.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate({ text, isInternalMessage: isInternal });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleContentChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(event.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  }

  const conv = data?.conversation as Conversation | undefined;
  const isResolved = conv?.status === 'resolved' || conv?.status === 'closed';
  const isAssignedToMe =
    !conv || conv.assigned_to === null || (currentUserId ? conv.assigned_to === currentUserId : false);
  const canSendMessage = isAssignedToMe && !isResolved;
  const isComposerAttachmentActive = isMediaActive || isAudioActive;
  const blockedMessage = isResolved
    ? 'Este atendimento foi encerrado'
    : 'Esta conversa foi transferida para outro agente';
  const name = conv?.client_name ?? 'Visitante';
  const chBadge = CH_BADGE[conv?.channel_type ?? ''];
  const statusStyle = STATUS_STYLE[conv?.status ?? ''];

  const grouped = useMemo(() => {
    const list: Array<{ date: string; msgs: Message[] }> = [];
    for (const msg of messages) {
      const date = formatDate(msg.created_at);
      const last = list[list.length - 1];
      if (last && last.date === date) {
        last.msgs.push(msg);
      } else {
        list.push({ date, msgs: [msg] });
      }
    }
    return list;
  }, [messages]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <div
        style={{
          background: 'var(--bg-2)',
          borderBottom: '1px solid var(--line)',
          padding: '0 20px',
          height: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div
            style={{
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
            }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{name}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              {chBadge && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '1px 7px',
                    borderRadius: 'var(--r-pill)',
                    fontSize: 10,
                    fontWeight: 500,
                    background: chBadge.bg,
                    color: chBadge.color,
                    border: `1px solid ${chBadge.border}`,
                  }}
                >
                  {chBadge.label}
                </span>
              )}
              {statusStyle && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '1px 7px',
                    borderRadius: 'var(--r-pill)',
                    fontSize: 10,
                    fontWeight: 500,
                    background: statusStyle.bg,
                    color: statusStyle.color,
                    border: `1px solid ${statusStyle.border}`,
                  }}
                >
                  {conv?.status ? t(`status.${conv.status}`, { defaultValue: conv.status }) : ''}
                </span>
              )}
              <span style={{ color: 'var(--txt-3)' }}>
                {t('history.total', { count: totalMessages, defaultValue: `${totalMessages} mensagens` })}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            title={t('chat.transfer')}
            onClick={() => setShowTransferModal(true)}
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              borderRadius: 'var(--r)',
              color: 'var(--txt-3)',
              cursor: 'pointer',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M9 3l4 4-4 4M13 7H5M1 7h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {!isResolved && (
            <button
              onClick={() => setShowResolveModal(true)}
              disabled={resolveMutation.isPending}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 11px',
                borderRadius: 'var(--r)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: '#0E1A18',
                opacity: resolveMutation.isPending ? 0.55 : 1,
              }}
            >
              {t('chat.resolve')}
            </button>
          )}

          {!isResolved && (
            <button
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '5px 11px',
                borderRadius: 'var(--r)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid var(--line-2)',
                background: 'var(--bg-4)',
                color: 'var(--txt-2)',
                opacity: closeMutation.isPending ? 0.55 : 1,
              }}
            >
              {t('chat.close', { defaultValue: 'Fechar' })}
            </button>
          )}
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--bg-4) transparent',
        }}
      >
        {hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
            <button
              type="button"
              disabled={isLoadingMore}
              onClick={() => void handleLoadOlder()}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                color: 'var(--txt-2)',
                fontSize: 12,
                cursor: 'pointer',
                opacity: isLoadingMore ? 0.65 : 1,
              }}
            >
              {isLoadingMore ? t('history.loading') : t('history.loadMore')}
            </button>
          </div>
        )}
        {!hasMore && messages.length > 0 && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--txt-3)', marginBottom: 8 }}>
            {t('history.noMore')}
          </div>
        )}

        {isLoadingMore && (
          <div style={{ marginBottom: 10 }}>
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                style={{
                  height: 14,
                  width: idx === 1 ? 200 : 160,
                  borderRadius: 6,
                  background: 'var(--bg-4)',
                  marginBottom: 8,
                  animation: 'pulse 1.2s ease-in-out infinite',
                }}
              />
            ))}
          </div>
        )}

        {(isLoading || isMessagesLoading) ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: '2px solid var(--teal)',
                borderTopColor: 'transparent',
                animation: 'spin 0.7s linear infinite',
              }}
            />
          </div>
        ) : messages.length === 0 ? (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--txt-3)', padding: '32px 0' }}>{t('chat.noMessages')}</p>
        ) : (
          grouped.map(({ date, msgs }) => (
            <div key={date}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 8px' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: 'var(--txt-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--mono)',
                  }}
                >
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
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-end',
                      marginBottom: 4,
                      flexDirection: isOut ? 'row-reverse' : 'row',
                    }}
                  >
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: isOut
                          ? 'linear-gradient(135deg,var(--teal),#00A88C)'
                          : avatarGradient(conv?.client_name ?? null),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#fff',
                        flexShrink: 0,
                        marginBottom: 2,
                      }}
                    >
                      {isOut ? (conv?.assigned_name ?? 'A').charAt(0).toUpperCase() : name.charAt(0).toUpperCase()}
                    </div>

                    <div style={{ maxWidth: '62%' }}>
                      <div
                        style={{
                          padding: '9px 13px',
                          borderRadius: 16,
                          borderBottomLeftRadius: isOut ? 16 : 4,
                          borderBottomRightRadius: isOut ? 4 : 16,
                          fontSize: 13,
                          lineHeight: 1.55,
                          wordBreak: 'break-word',
                          background: msg.is_internal ? 'var(--amber-dim)' : isOut ? 'var(--teal)' : 'var(--bg-3)',
                          color: msg.is_internal ? 'var(--amber)' : isOut ? '#0a1a18' : 'var(--txt)',
                          border: msg.is_internal
                            ? '1px solid rgba(245,158,11,.3)'
                            : isOut
                              ? 'none'
                              : '1px solid var(--line)',
                        }}
                      >
                        {msg.is_internal && (
                          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {t('chat.internalNote')}
                          </div>
                        )}
                        {msg.content_type !== 'text' && (
                          <div style={{ marginBottom: msg.content ? 6 : 0 }}>
                            <MessageMedia
                              message={msg}
                              conversationId={conversationId}
                              localMediaUrl={msg.media_url ? localMediaUrls[msg.media_url] : undefined}
                            />
                          </div>
                        )}
                        {msg.content}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          marginTop: 4,
                          fontSize: 10,
                          fontFamily: 'var(--mono)',
                          color: 'var(--txt-3)',
                          justifyContent: isOut ? 'flex-end' : 'flex-start',
                        }}
                      >
                        {formatTime(msg.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}

        <div ref={bottomRef} style={{ height: 1 }} />

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

      {canSendMessage && !isComposerAttachmentActive && (
        <div style={{ display: 'flex', gap: 6, padding: '0 20px 10px', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 }}>
          {([
            t('chat.sendProposal'),
            t('chat.scheduleCall'),
            t('chat.sendPaymentLink'),
            t('chat.awaitReturn'),
            t('chat.sendContract'),
            t('chat.qualifyLead'),
          ] as string[]).map((reply) => (
            <button
              key={reply}
              onClick={() => setContent((prev) => (prev ? prev + ' ' + reply : reply))}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '5px 12px',
                borderRadius: 'var(--r-pill)',
                border: '1px solid var(--line-2)',
                background: 'var(--bg-3)',
                color: 'var(--txt-2)',
                fontSize: 12,
                fontFamily: 'var(--font)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      <div style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line)', padding: '12px 16px', flexShrink: 0 }}>
        {canSendMessage && (
          <>
            <MediaUpload
              ref={mediaUploadRef}
              conversationId={conversationId}
              disabled={!canSendMessage}
              onActiveChange={setIsMediaActive}
              onSent={async (payload) => {
                registerLocalMediaPreview(payload);
                nextScrollBehaviorRef.current = 'smooth';
                void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
                void qc.invalidateQueries({ queryKey: ['conversations'] });
                await loadLatestMessages(true);
              }}
            />
            <AudioRecorder
              ref={audioRecorderRef}
              conversationId={conversationId}
              disabled={!canSendMessage}
              onActiveChange={setIsAudioActive}
              onSent={async (payload) => {
                registerLocalMediaPreview(payload);
                nextScrollBehaviorRef.current = 'smooth';
                void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
                void qc.invalidateQueries({ queryKey: ['conversations'] });
                await loadLatestMessages(true);
              }}
            />
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 8 }}>
          {canSendMessage && (
            <>
              <button
                type="button"
                onClick={() => mediaUploadRef.current?.openPicker('image/jpeg,image/png,image/webp,image/gif,audio/ogg,audio/mp4,audio/mpeg,audio/amr,audio/aac,audio/opus,video/mp4,video/3gpp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain')}
                title={t('media.upload')}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--r)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  color: 'var(--txt-2)',
                  cursor: 'pointer',
                }}
              >
                📎
              </button>
              <button
                type="button"
                onClick={() => mediaUploadRef.current?.openPicker('image/*')}
                title={t('media.uploadImage')}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--r)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  color: 'var(--txt-2)',
                  cursor: 'pointer',
                }}
              >
                🖼️
              </button>
              <button
                type="button"
                onClick={() => void audioRecorderRef.current?.start()}
                title={t('media.record')}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--r)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  color: 'var(--txt-2)',
                  cursor: 'pointer',
                }}
              >
                🎤
              </button>
            </>
          )}
          <button
            disabled={!canSendMessage}
            onClick={() => setIsInternal((prev) => !prev)}
            title={t('chat.internalNote')}
            style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--r)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isInternal ? 'var(--amber-dim)' : 'none',
              border: isInternal ? '1px solid rgba(245,158,11,.3)' : 'none',
              color: 'var(--amber)',
              cursor: canSendMessage ? 'pointer' : 'not-allowed',
              opacity: canSendMessage ? 1 : 0.5,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <path d="M2 9.5L3.5 8l6-6 1.5 1.5-6 6L2 11v-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {canSendMessage ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              background: isInternal ? 'var(--amber-dim)' : 'var(--bg-3)',
              border: `1px solid ${isInternal ? 'rgba(245,158,11,.3)' : 'var(--line-2)'}`,
              borderRadius: 'var(--r-lg)',
              padding: '10px 12px',
            }}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={content}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              placeholder={isComposerAttachmentActive ? t('media.caption') : isInternal ? t('chat.internalNote') + '...' : t('chat.inputPlaceholder')}
              disabled={!canSendMessage || isComposerAttachmentActive}
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
              }}
            />
            <button
              onClick={handleSend}
              disabled={!content.trim() || sendMutation.isPending || !canSendMessage || isComposerAttachmentActive}
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--r)',
                background: isInternal ? 'var(--amber)' : 'var(--teal)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                color: '#0E1A18',
                opacity: (!content.trim() || sendMutation.isPending || !canSendMessage || isComposerAttachmentActive) ? 0.4 : 1,
              }}
              aria-label={t('chat.send')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              background: 'var(--bg-3)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-lg)',
              padding: '11px 12px',
              color: 'var(--txt-3)',
              fontStyle: 'italic',
              cursor: 'not-allowed',
            }}
          >
            <span>{blockedMessage}</span>
            {isResolved && (
              <button
                onClick={() => reopenMutation.mutate()}
                disabled={reopenMutation.isPending}
                style={{
                  background: 'var(--bg-2)',
                  border: '1px solid rgba(0,201,167,.25)',
                  color: 'var(--teal)',
                  borderRadius: 'var(--r)',
                  padding: '4px 10px',
                  fontSize: 12,
                  fontStyle: 'normal',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('resolve.reopen', { defaultValue: 'Reabrir' })}
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)' }}>
            {isComposerAttachmentActive
              ? t('media.caption')
              : canSendMessage && content.length > 0
              ? t('chat.charCount', { count: content.length })
              : canSendMessage && isInternal
                ? <span style={{ color: 'var(--amber)', fontWeight: 500 }}>{t('chat.internalNoteActive')}</span>
                : t('chat.ctrlEnter')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--txt-3)' }}>
            <span>{t('chat.via')}</span>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'var(--bg-4)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r)',
                padding: '3px 8px',
                fontSize: 11,
                color: 'var(--txt-2)',
              }}
            >
              {conv?.channel_type === 'whatsapp' ? 'WhatsApp' : conv?.channel_type === 'email' ? 'E-mail' : 'Chat'}
            </div>
          </div>
        </div>
      </div>

      <ResolveModal
        open={showResolveModal}
        onClose={() => setShowResolveModal(false)}
        isSubmitting={resolveMutation.isPending}
        onConfirm={async (payload) => {
          await resolveMutation.mutateAsync(payload);
        }}
      />

      <TransferModal
        open={showTransferModal}
        conversationId={conversationId}
        onClose={() => setShowTransferModal(false)}
        onTransferred={async ({ name: agentName }) => {
          await transferSystemMessage.mutateAsync(agentName);
        }}
      />
    </div>
  );
}
