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

const COMMON_EMOJIS = [
  '😊', '👍', '🙏', '✅', '⏰', '📋',
  '🔥', '❤️', '😄', '👋', '😅', '🤝',
  '📞', '💬', '✔️', '⚡', '🎯', '💡',
] as const;

interface ToolbarButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  active?: boolean;
  activeColor?: string;
}

function ToolbarButton({ icon, tooltip, onClick, active = false, activeColor = 'var(--teal)' }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={tooltip}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: active ? `${activeColor}26` : 'transparent',
        border: active ? `1px solid ${activeColor}66` : '1px solid transparent',
        color: active ? activeColor : 'var(--txt-2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all .15s',
        position: 'relative',
      }}
      onMouseEnter={(event) => {
        const target = event.currentTarget;
        if (!active) target.style.background = 'var(--bg-4)';
        if (!active) target.style.color = 'var(--txt)';
      }}
      onMouseLeave={(event) => {
        const target = event.currentTarget;
        target.style.background = active ? `${activeColor}26` : 'transparent';
        target.style.color = active ? activeColor : 'var(--txt-2)';
      }}
    >
      {icon}
    </button>
  );
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const quickRepliesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaUploadRef = useRef<MediaUploadHandle>(null);
  const audioRecorderRef = useRef<AudioRecorderHandle>(null);
  const lastMessagesErrorAtRef = useRef(0);
  const isLoadingLatestRef = useRef(false);
  const shouldAutoScrollNextRef = useRef(true);
  const pendingInitialScrollRef = useRef(true);
  const nextScrollBehaviorRef = useRef<ScrollBehavior>('smooth');
  const localMediaUrlsRef = useRef<Record<string, string>>({});
  const [isMediaActive, setIsMediaActive] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const apply = () => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const targetTop = container.scrollHeight;
      if (behavior === 'auto') {
        container.scrollTop = targetTop;
        return;
      }
      container.scrollTo({ top: targetTop, behavior });
    };

    apply();
    window.requestAnimationFrame(apply);
  }, []);

  const isNearBottom = useCallback((threshold = 80) => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    return distanceToBottom <= threshold;
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

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        showEmojiPicker &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(target)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        showQuickReplies &&
        quickRepliesRef.current &&
        !quickRepliesRef.current.contains(target)
      ) {
        setShowQuickReplies(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showEmojiPicker, showQuickReplies]);

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
    if (!preserveOlder) {
      setIsMessagesLoading(true);
    }
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
      if (!preserveOlder) {
        setIsMessagesLoading(false);
      }
    }
  }, [conversationId, notifyMessagesLoadError]);

  useEffect(() => {
    setContent('');
    setIsInternal(false);
    setShowEmojiPicker(false);
    setShowQuickReplies(false);
    clearLocalMediaPreviews();
    pendingInitialScrollRef.current = true;
    shouldAutoScrollNextRef.current = true;
    nextScrollBehaviorRef.current = 'auto';
    void loadLatestMessages(false);
  }, [clearLocalMediaPreviews, conversationId, loadLatestMessages]);

  useEffect(() => {
    if (!pendingInitialScrollRef.current) return;
    if (!messages.length) return;
    if (isLoading || isMessagesLoading) return;

    scrollToBottom('auto');
    pendingInitialScrollRef.current = false;
  }, [conversationId, isLoading, isMessagesLoading, messages.length, scrollToBottom]);

  const latestMessageKey = messages.length
    ? `${messages.length}:${messages[messages.length - 1]?.id ?? ''}`
    : '0';

  useEffect(() => {
    if (!messages.length) return;
    if (!shouldAutoScrollNextRef.current) {
      return;
    }

    const behavior = nextScrollBehaviorRef.current;
    nextScrollBehaviorRef.current = 'smooth';
    scrollToBottom(behavior);
  }, [latestMessageKey, messages.length, scrollToBottom]);

  useEffect(() => {
    const unsubNew = subscribeToEvent<{ conversationId: string }>('conversation:new_message', (event) => {
      if (event.conversationId !== conversationId) return;
      shouldAutoScrollNextRef.current = isNearBottom();
      if (shouldAutoScrollNextRef.current) {
        nextScrollBehaviorRef.current = 'smooth';
      }
      void loadLatestMessages(true);
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });

    const unsubIncoming = subscribeToEvent<{ conversationId: string }>('conversation:message', (event) => {
      if (event.conversationId !== conversationId) return;
      shouldAutoScrollNextRef.current = isNearBottom();
      if (shouldAutoScrollNextRef.current) {
        nextScrollBehaviorRef.current = 'smooth';
      }
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
  }, [conversationId, isNearBottom, loadLatestMessages, qc]);

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
      shouldAutoScrollNextRef.current = true;
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
      shouldAutoScrollNextRef.current = true;
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
      shouldAutoScrollNextRef.current = false;
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

  function applyComposerText(text: string) {
    setContent(text);
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    });
  }

  function appendEmojiToComposer(emoji: string) {
    applyComposerText(`${content}${emoji}`);
    setShowEmojiPicker(false);
  }

  function handleQuickReplySelect(reply: string) {
    applyComposerText(reply);
    setShowQuickReplies(false);
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
  const channelLabel = conv?.channel_type === 'whatsapp' ? 'WhatsApp' : conv?.channel_type === 'email' ? 'E-mail' : 'Chat';
  const hasTypedContent = content.trim().length > 0;
  const quickReplyOptions = useMemo(() => ([
    t('chat.sendProposal'),
    t('chat.scheduleCall'),
    t('chat.sendPaymentLink'),
    t('chat.awaitReturn'),
    t('chat.sendContract'),
    t('chat.qualifyLead'),
  ]), [t]);

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
	                const hideAudioLabel = msg.content_type === 'audio' && msg.sender_type === 'client';
	                const showMessageContent = Boolean(msg.content) && !hideAudioLabel;
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
	                          <div style={{ marginBottom: showMessageContent ? 6 : 0 }}>
	                            <MessageMedia
	                              message={msg}
	                              conversationId={conversationId}
	                              localMediaUrl={msg.media_url ? localMediaUrls[msg.media_url] : undefined}
	                            />
	                          </div>
	                        )}
	                        {showMessageContent ? msg.content : null}
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

      <div
        style={{
          background: isInternal ? 'rgba(245,158,11,.05)' : 'var(--bg-2)',
          borderTop: `1px solid ${isInternal ? 'rgba(245,158,11,.25)' : 'var(--line)'}`,
          padding: '12px 16px',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {canSendMessage && (
          <>
            <MediaUpload
              ref={mediaUploadRef}
              conversationId={conversationId}
              disabled={!canSendMessage}
              onActiveChange={setIsMediaActive}
              onSent={async (payload) => {
                registerLocalMediaPreview(payload);
                shouldAutoScrollNextRef.current = true;
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
                shouldAutoScrollNextRef.current = true;
                nextScrollBehaviorRef.current = 'smooth';
                void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
                void qc.invalidateQueries({ queryKey: ['conversations'] });
                await loadLatestMessages(true);
              }}
            />
          </>
        )}

        {canSendMessage && showQuickReplies && !isAudioActive && (
          <div
            ref={quickRepliesRef}
            style={{
              position: 'absolute',
              left: 16,
              bottom: 'calc(100% + 8px)',
              width: 280,
              borderRadius: 10,
              border: '1px solid var(--line-2)',
              background: 'var(--bg-3)',
              boxShadow: '0 12px 30px rgba(0,0,0,.35)',
              zIndex: 25,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 600, color: 'var(--txt-2)' }}>
              ⚡ Respostas rápidas
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {quickReplyOptions.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => handleQuickReplySelect(reply)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    border: 'none',
                    borderBottom: '1px solid var(--line)',
                    background: 'transparent',
                    color: 'var(--txt)',
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-4)'; }}
                  onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
                >
                  {reply}
                </button>
              ))}
            </div>
          </div>
        )}

        {canSendMessage && showEmojiPicker && !isAudioActive && (
          <div
            ref={emojiPickerRef}
            style={{
              position: 'absolute',
              left: 116,
              bottom: 'calc(100% + 8px)',
              width: 230,
              borderRadius: 10,
              border: '1px solid var(--line-2)',
              background: 'var(--bg-3)',
              boxShadow: '0 12px 30px rgba(0,0,0,.35)',
              zIndex: 25,
              padding: 10,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
              {COMMON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => appendEmojiToComposer(emoji)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: 'var(--txt)',
                    fontSize: 18,
                    cursor: 'pointer',
                    transition: 'all .15s',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'var(--bg-4)';
                    event.currentTarget.style.borderColor = 'var(--line)';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent';
                    event.currentTarget.style.borderColor = 'transparent';
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isAudioActive && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {canSendMessage && (
                  <>
                    <ToolbarButton
                      tooltip="Anexar arquivo"
                      onClick={() => mediaUploadRef.current?.openPicker('application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain')}
                      icon={(
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M13.5 7.5L7.5 13.5C6.1 14.9 3.9 14.9 2.5 13.5C1.1 12.1 1.1 9.9 2.5 8.5L9 2C9.9 1.1 11.4 1.1 12.3 2C13.2 2.9 13.2 4.4 12.3 5.3L6.3 11.3C5.9 11.7 5.2 11.7 4.8 11.3C4.4 10.9 4.4 10.2 4.8 9.8L10.3 4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      )}
                    />
                    <ToolbarButton
                      tooltip="Imagem ou vídeo"
                      onClick={() => mediaUploadRef.current?.openPicker('image/jpeg,image/png,image/webp,video/mp4')}
                      icon={(
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <rect x="1.5" y="3" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
                          <circle cx="5.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
                          <path d="M1.5 11L5 7.5L8 10.5L11 8L14.5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    />
                    <ToolbarButton
                      tooltip="Emoji"
                      active={showEmojiPicker}
                      onClick={() => {
                        setShowQuickReplies(false);
                        setShowEmojiPicker((prev) => !prev);
                      }}
                      icon={(
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
                          <circle cx="5.5" cy="6.5" r="0.8" fill="currentColor" />
                          <circle cx="10.5" cy="6.5" r="0.8" fill="currentColor" />
                          <path d="M5 10c.8 1.5 5.2 1.5 6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      )}
                    />
                    <ToolbarButton
                      tooltip="Respostas rápidas"
                      active={showQuickReplies}
                      onClick={() => {
                        setShowEmojiPicker(false);
                        setShowQuickReplies((prev) => !prev);
                      }}
                      icon={(
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M9.5 1.5L3 9h5.5L6.5 14.5l7.5-8H8.5L9.5 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    />
                    <ToolbarButton
                      tooltip="Nota interna"
                      active={isInternal}
                      activeColor="var(--amber)"
                      onClick={() => setIsInternal((prev) => !prev)}
                      icon={(
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M11 2L14 5L5 14H2V11L11 2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M2 14h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      )}
                    />
                  </>
                )}
              </div>

              <div
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: 'var(--bg-4)',
                  color: 'var(--txt-2)',
                  fontSize: 11,
                  padding: '6px 9px',
                }}
              >
                <span>{channelLabel}</span>
              </div>
            </div>

            {canSendMessage ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 8,
                  background: isInternal ? 'rgba(245,158,11,.08)' : 'var(--bg-3)',
                  border: `1px solid ${isInternal ? 'rgba(245,158,11,.3)' : 'var(--line-2)'}`,
                  borderRadius: 12,
                  padding: '10px 10px 10px 12px',
                }}
              >
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={content}
                  onChange={handleContentChange}
                  onKeyDown={handleKeyDown}
                  placeholder={isComposerAttachmentActive ? t('media.caption') : isInternal ? 'Escreva uma nota interna...' : t('chat.inputPlaceholder')}
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
                    minHeight: 22,
                    maxHeight: 120,
                    lineHeight: 1.5,
                  }}
                />

                <button
                  type="button"
                  onClick={hasTypedContent ? handleSend : () => void audioRecorderRef.current?.start()}
                  disabled={
                    !canSendMessage ||
                    isComposerAttachmentActive ||
                    (hasTypedContent ? sendMutation.isPending : false)
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: 'none',
                    cursor: 'pointer',
                    position: 'relative',
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: hasTypedContent ? 'var(--teal)' : 'var(--bg-4)',
                    color: hasTypedContent ? '#0a1a18' : 'var(--txt-2)',
                    transition: 'all .2s cubic-bezier(.4,0,.2,1)',
                    opacity: (!canSendMessage || isComposerAttachmentActive || (hasTypedContent && sendMutation.isPending)) ? 0.45 : 1,
                  }}
                  onMouseEnter={(event) => {
                    if (!hasTypedContent) {
                      event.currentTarget.style.background = 'var(--bg-5)';
                      event.currentTarget.style.color = 'var(--teal)';
                    } else {
                      event.currentTarget.style.filter = 'brightness(1.05)';
                    }
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.filter = 'none';
                    event.currentTarget.style.background = hasTypedContent ? 'var(--teal)' : 'var(--bg-4)';
                    event.currentTarget.style.color = hasTypedContent ? '#0a1a18' : 'var(--txt-2)';
                  }}
                  aria-label={hasTypedContent ? t('chat.send') : t('media.record')}
                  title={hasTypedContent ? t('chat.send') : t('media.record')}
                >
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: hasTypedContent ? 0 : 1,
                      transform: hasTypedContent ? 'scale(.7)' : 'scale(1)',
                      transition: 'all .2s cubic-bezier(.4,0,.2,1)',
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                      <rect x="6" y="1.5" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M3 9c0 3.3 2.7 6 6 6s6-2.7 6-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      <path d="M9 15v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: hasTypedContent ? 1 : 0,
                      transform: hasTypedContent ? 'scale(1)' : 'scale(.7)',
                      transition: 'all .2s cubic-bezier(.4,0,.2,1)',
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                      <path d="M16 2L1 8.5l6 1.5 1.5 6L16 2z" fill="currentColor" />
                      <path d="M7 10l4-4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
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
                  borderRadius: 12,
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
                    : 'Enter para enviar'}
              </span>
            </div>
          </>
        )}
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
