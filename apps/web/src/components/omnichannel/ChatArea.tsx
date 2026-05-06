import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  omnichannelApi,
  type OmnichannelConversation,
  type OmnichannelMessage,
  type QuickReply,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useAuthStore } from '../../stores/auth.store';
import { subscribeToEvent } from '../../services/socket';
import { ResolveModal } from './ResolveModal';
import { TransferModal } from './TransferModal';
import { MediaUpload, type MediaUploadHandle, type SentMediaPayload } from './MediaUpload';
import { AudioRecorder, type AudioRecorderHandle } from './AudioRecorder';
import { MessageMedia } from './MessageMedia';
import { RequestHelpModal } from './RequestHelpModal';
import { TagDropdown } from './TagDropdown';

type Message = OmnichannelMessage;
type Conversation = OmnichannelConversation;
type MentionData = NonNullable<NonNullable<Message['metadata']>['mention']>;
type CallRecordingMetadata = {
  recording_url: string;
  duration?: number;
  call_sid?: string;
};

const QUICK_REPLY_VARIABLE_PATTERN = /\{\{(nome|empresa|protocolo|agente|data|hora)\}\}/g;

function resolveVariables(text: string, context: {
  contactName?: string | null;
  organizationName?: string | null;
  protocolNumber?: string | null;
  agentName?: string | null;
}) {
  const now = new Date();
  return text
    .replace(/\{\{nome\}\}/g, context.contactName ?? '')
    .replace(/\{\{empresa\}\}/g, context.organizationName ?? '')
    .replace(/\{\{protocolo\}\}/g, context.protocolNumber ?? '')
    .replace(/\{\{agente\}\}/g, context.agentName ?? '')
    .replace(/\{\{data\}\}/g, now.toLocaleDateString('pt-BR'))
    .replace(/\{\{hora\}\}/g, now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }));
}

function highlightQuickReplyVariables(text: string) {
  const matches = Array.from(text.matchAll(QUICK_REPLY_VARIABLE_PATTERN));
  if (matches.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    const fullMatch = match[0];
    const index = match.index ?? 0;

    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }

    const variableName = fullMatch.slice(2, -2);
    parts.push(
      <span key={`${variableName}-${index}`} style={{ color: 'var(--teal)', fontWeight: 600 }}>
        [{variableName}]
      </span>,
    );

    cursor = index + fullMatch.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
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
  email: { bg: 'var(--blue-dim)', color: 'var(--blue)', border: 'rgba(96,165,250,.25)', label: 'E-mail' },
  live_chat: { bg: 'var(--bg-5)', color: 'var(--txt-2)', border: 'var(--line-2)', label: 'Chat' },
};

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  open: { color: 'var(--amber)', bg: 'var(--amber-dim)', border: 'rgba(245,158,11,.25)' },
  active_outbound: { color: 'var(--amber)', bg: 'var(--amber-dim)', border: 'rgba(245,158,11,.25)' },
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

function revokeIfBlobUrl(url: string | null | undefined) {
  if (!url) return;
  if (!url.startsWith('blob:')) return;
  URL.revokeObjectURL(url);
}

const COMMON_EMOJIS = [
  '😊', '👍', '🙏', '✅', '⏰', '📋',
  '🔥', '❤️', '😄', '👋', '😅', '🤝',
  '📞', '💬', '✔️', '⚡', '🎯', '💡',
] as const;

function buildMentionPreview(content: string | null | undefined, contentType: string): string {
  const normalized = (content ?? '').trim();
  if (normalized) return normalized.slice(0, 255);

  switch (contentType) {
    case 'image':
      return '[Imagem]';
    case 'audio':
      return '[Áudio]';
    case 'video':
      return '[Vídeo]';
    case 'document':
      return '[Documento]';
    default:
      return '[Mensagem]';
  }
}

function extractMessageMediaId(message: Message): string | null {
  if (message.media_url?.trim()) return message.media_url.trim();
  if (!message.metadata || typeof message.metadata !== 'object') return null;
  const mediaId = (message.metadata as Record<string, unknown>).media_id;
  return typeof mediaId === 'string' && mediaId.trim() ? mediaId.trim() : null;
}

function parseCallRecordingMetadata(message: Message): CallRecordingMetadata | null {
  if (message.content_type !== 'call_recording') return null;
  if (!message.metadata || typeof message.metadata !== 'object') return null;

  const metadata = message.metadata as Record<string, unknown>;
  const recordingUrl = metadata.recording_url;
  if (typeof recordingUrl !== 'string' || !recordingUrl.trim()) return null;

  const durationRaw = metadata.duration;
  const duration = typeof durationRaw === 'number'
    ? durationRaw
    : typeof durationRaw === 'string' && durationRaw.trim()
      ? Number(durationRaw)
      : undefined;

  const callSidRaw = metadata.call_sid;
  const callSid = typeof callSidRaw === 'string' ? callSidRaw : undefined;

  return {
    recording_url: recordingUrl,
    ...(Number.isFinite(duration) ? { duration: Number(duration) } : {}),
    ...(callSid ? { call_sid: callSid } : {}),
  };
}

function formatCallRecordingDuration(seconds: number | undefined): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds!)) : 0;
  const minutes = Math.floor(value / 60);
  const remainingSeconds = value % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function mentionTypeLabel(mention: MentionData): string {
  if (mention.content_type === 'image') {
    return mention.media_subtype === 'sticker' ? 'Figurinha' : 'Foto';
  }
  if (mention.content_type === 'video') return 'Vídeo';
  if (mention.content_type === 'audio') return 'Áudio';
  if (mention.content_type === 'document') return 'Documento';
  return mention.content;
}

function MentionMediaThumb({ conversationId, mediaId }: { conversationId: string; mediaId: string }) {
  const { data: mediaBlob } = useQuery({
    queryKey: ['mention-media-thumb', conversationId, mediaId],
    queryFn: () => omnichannelApi.downloadMedia(mediaId, conversationId),
    staleTime: 60 * 60 * 1000,
  });
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaBlob) return;
    const url = URL.createObjectURL(mediaBlob);
    setThumbUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [mediaBlob]);

  if (!thumbUrl) return null;

  return (
    <img
      src={thumbUrl}
      alt="mídia mencionada"
      style={{
        width: 34,
        height: 34,
        borderRadius: 6,
        objectFit: 'cover',
        border: '1px solid var(--line)',
        flexShrink: 0,
      }}
    />
  );
}

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
  const { t: tAdmin } = useTranslation('admin');
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const currentAuthToken = useAuthStore((state) => state.token);
  const currentUserName = useAuthStore((state) => state.user?.name);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const currentUserRole = useAuthStore((state) => state.user?.role);
  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [isTyping, _setIsTyping] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isMessagesLoading, setIsMessagesLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [localMediaUrls, setLocalMediaUrls] = useState<Record<string, string>>({});
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showShortcutSuggestions, setShowShortcutSuggestions] = useState(false);
  const [shortcutSuggestions, setShortcutSuggestions] = useState<QuickReply[]>([]);
  const [selectedShortcutIndex, setSelectedShortcutIndex] = useState(0);
  const [unseenMessageCount, setUnseenMessageCount] = useState(0);
  const [isAssuming, setIsAssuming] = useState(false);
  const [mentioningMessage, setMentioningMessage] = useState<MentionData | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const quickRepliesRef = useRef<HTMLDivElement>(null);
  const shortcutDropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaUploadRef = useRef<MediaUploadHandle>(null);
  const audioRecorderRef = useRef<AudioRecorderHandle>(null);
  const lastMessagesErrorAtRef = useRef(0);
  const isLoadingLatestRef = useRef(false);
  const shouldAutoScrollNextRef = useRef(true);
  const stickToBottomRef = useRef(true);
  const pendingInitialScrollRef = useRef(true);
  const nextScrollBehaviorRef = useRef<ScrollBehavior>('smooth');
  const localMediaUrlsRef = useRef<Record<string, string>>({});
  const messagesRef = useRef<Message[]>([]);
  const pendingIncomingNoticeRef = useRef(false);
  const [isMediaActive, setIsMediaActive] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const hasValidSession = Boolean(conversationId) && isAuthenticated && Boolean(currentAuthToken);

  const shouldRetryQuery = useCallback((failureCount: number, error: unknown) => {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 401) return false;
    return failureCount < 1;
  }, []);

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

  const syncBottomAnchor = useCallback(() => {
    const nearBottom = isNearBottom();
    stickToBottomRef.current = nearBottom;
    shouldAutoScrollNextRef.current = nearBottom;
    if (nearBottom) {
      pendingIncomingNoticeRef.current = false;
      setUnseenMessageCount(0);
    }
  }, [isNearBottom]);

  const jumpToLatestMessages = useCallback((behavior: ScrollBehavior = 'smooth') => {
    pendingIncomingNoticeRef.current = false;
    stickToBottomRef.current = true;
    shouldAutoScrollNextRef.current = true;
    nextScrollBehaviorRef.current = behavior;
    setUnseenMessageCount(0);
    scrollToBottom(behavior);
  }, [scrollToBottom]);

  const registerLocalMediaPreview = useCallback((payload: SentMediaPayload) => {
    setLocalMediaUrls((prev) => {
      const currentForMedia = prev[payload.mediaId];
      if (currentForMedia && currentForMedia !== payload.localPreviewUrl) {
        revokeIfBlobUrl(currentForMedia);
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
        revokeIfBlobUrl(url);
      }
      return {};
    });
  }, []);

  useEffect(() => {
    localMediaUrlsRef.current = localMediaUrls;
  }, [localMediaUrls]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(localMediaUrlsRef.current)) {
        revokeIfBlobUrl(url);
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
      if (
        showShortcutSuggestions &&
        shortcutDropdownRef.current &&
        !shortcutDropdownRef.current.contains(target)
      ) {
        setShowShortcutSuggestions(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showEmojiPicker, showQuickReplies, showShortcutSuggestions]);

  const { data, isLoading, isError: isConversationError } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => omnichannelApi.getConversation(conversationId),
    enabled: hasValidSession,
    retry: shouldRetryQuery,
  });

  const { data: quickReplies = [] } = useQuery({
    queryKey: ['admin', 'quick-replies', 'chat'],
    queryFn: () => adminApi.quickReplies.list(),
    staleTime: 5 * 60 * 1000,
    enabled: hasValidSession,
    retry: shouldRetryQuery,
  });

  const { data: helpers = [] } = useQuery({
    queryKey: ['conversation', conversationId, 'helpers'],
    queryFn: () => omnichannelApi.getHelpers(conversationId),
    enabled: hasValidSession,
    retry: shouldRetryQuery,
  });

  const notifyMessagesLoadError = useCallback(() => {
    const now = Date.now();
    if (now - lastMessagesErrorAtRef.current < 2500) return;
    lastMessagesErrorAtRef.current = now;
    toast.error(t('history.error', { defaultValue: 'Erro ao carregar mensagens' }));
  }, [t, toast]);

  const loadLatestMessages = useCallback(async (preserveOlder: boolean) => {
    if (!hasValidSession) {
      if (!preserveOlder) {
        setIsMessagesLoading(false);
      }
      return;
    }
    if (isLoadingLatestRef.current) return;
    isLoadingLatestRef.current = true;
    if (!preserveOlder) {
      setIsMessagesLoading(true);
    }
    try {
      const result = await omnichannelApi.listMessages(conversationId, { per_page: 50, page: 1 });
      const currentMessages = messagesRef.current;
      const currentIds = new Set(currentMessages.map((msg) => msg.id));
      const newlyAddedCount = preserveOlder
        ? result.data.reduce((count, msg) => count + (currentIds.has(msg.id) ? 0 : 1), 0)
        : 0;
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
      if (preserveOlder && pendingIncomingNoticeRef.current && !shouldAutoScrollNextRef.current && newlyAddedCount > 0) {
        setUnseenMessageCount((prev) => prev + newlyAddedCount);
        pendingIncomingNoticeRef.current = false;
      } else if (!preserveOlder || shouldAutoScrollNextRef.current) {
        setUnseenMessageCount(0);
      }

    } catch {
      notifyMessagesLoadError();
    } finally {
      isLoadingLatestRef.current = false;
      if (!preserveOlder) {
        setIsMessagesLoading(false);
      }
    }
  }, [conversationId, hasValidSession, notifyMessagesLoadError]);

  useEffect(() => {
    setContent('');
    setIsInternal(false);
    setShowEmojiPicker(false);
    setShowQuickReplies(false);
    setShowTagDropdown(false);
    setShowShortcutSuggestions(false);
    setShortcutSuggestions([]);
    setSelectedShortcutIndex(0);
    setMentioningMessage(null);
    clearLocalMediaPreviews();
    pendingInitialScrollRef.current = true;
    stickToBottomRef.current = true;
    pendingIncomingNoticeRef.current = false;
    shouldAutoScrollNextRef.current = true;
    nextScrollBehaviorRef.current = 'auto';
    setUnseenMessageCount(0);

    if (!hasValidSession) {
      setMessages([]);
      setHasMore(false);
      setTotalMessages(0);
      setIsMessagesLoading(false);
      return;
    }

    setIsMessagesLoading(true);
  }, [clearLocalMediaPreviews, conversationId, hasValidSession]);

  useEffect(() => {
    if (!hasValidSession) return;
    if (!data?.conversation) return;
    void loadLatestMessages(false);
  }, [data?.conversation?.id, hasValidSession, loadLatestMessages]);

  useEffect(() => {
    if (!isConversationError) return;
    setIsMessagesLoading(false);
  }, [isConversationError]);

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
    const container = messagesContainerRef.current;
    if (!container) return;

    const keepBottomAnchored = () => {
      if (!pendingInitialScrollRef.current && !stickToBottomRef.current) return;
      nextScrollBehaviorRef.current = 'auto';
      scrollToBottom('auto');
    };

    const mutationObserver = new MutationObserver(() => {
      keepBottomAnchored();
    });

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const handleMediaLayout = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLImageElement ||
        target instanceof HTMLVideoElement ||
        target instanceof HTMLAudioElement
      ) {
        keepBottomAnchored();
      }
    };

    container.addEventListener('load', handleMediaLayout, true);
    container.addEventListener('loadedmetadata', handleMediaLayout, true);

    return () => {
      mutationObserver.disconnect();
      container.removeEventListener('load', handleMediaLayout, true);
      container.removeEventListener('loadedmetadata', handleMediaLayout, true);
    };
  }, [conversationId, scrollToBottom]);

  useEffect(() => {
    if (!hasValidSession) return;

    const handleIncomingConversationUpdate = () => {
      const nearBottom = isNearBottom();
      shouldAutoScrollNextRef.current = nearBottom;
      stickToBottomRef.current = nearBottom;
      if (nearBottom) {
        nextScrollBehaviorRef.current = 'smooth';
        setUnseenMessageCount(0);
      } else {
        pendingIncomingNoticeRef.current = true;
      }
    };

    const unsubNew = subscribeToEvent<{ conversationId: string }>('conversation:new_message', (event) => {
      if (event.conversationId !== conversationId) return;
      handleIncomingConversationUpdate();
      void loadLatestMessages(true);
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });

    const unsubIncoming = subscribeToEvent<{ conversationId: string }>('conversation:message', (event) => {
      if (event.conversationId !== conversationId) return;
      handleIncomingConversationUpdate();
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

    const unsubUpdated = subscribeToEvent<{
      conversationId?: string;
      conversation?: { id?: string };
    }>('conversation:updated', (event) => {
      const updatedConversationId = event.conversationId ?? event.conversation?.id;
      if (updatedConversationId !== conversationId) return;
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });
    const unsubCsatUpdated = subscribeToEvent<{ conversationId: string }>('conversation:csat_updated', (event) => {
      if (event.conversationId !== conversationId) return;
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });

    const unsubHelpRequested = subscribeToEvent<{ conversationId: string }>('help:requested', (event) => {
      if (event.conversationId !== conversationId) return;
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId, 'helpers'] });
    });

    const unsubHelpAccepted = subscribeToEvent<{ conversationId: string }>('help:accepted', (event) => {
      if (event.conversationId !== conversationId) return;
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId, 'helpers'] });
    });

    const unsubHelpDeclined = subscribeToEvent<{ conversationId: string }>('help:declined', (event) => {
      if (event.conversationId !== conversationId) return;
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId, 'helpers'] });
    });

    const unsubCallStatus = subscribeToEvent<{ conversationId: string }>('call:status', (event) => {
      if (event.conversationId !== conversationId) return;
      void qc.invalidateQueries({ queryKey: ['call-history', conversationId] });
    });

    return () => {
      unsubNew();
      unsubIncoming();
      unsubResolved();
      unsubTransferred();
      unsubUpdated();
      unsubCsatUpdated();
      unsubHelpRequested();
      unsubHelpAccepted();
      unsubHelpDeclined();
      unsubCallStatus();
    };
  }, [conversationId, hasValidSession, isNearBottom, loadLatestMessages, qc]);

  const sendMutation = useMutation({
    mutationFn: (payload: { text: string; isInternalMessage: boolean; mentionMessageId?: string | null }) =>
      omnichannelApi.sendMessage(conversationId, {
        content: payload.text,
        contentType: 'text',
        isInternal: payload.isInternalMessage,
        ...(payload.mentionMessageId ? { mention_message_id: payload.mentionMessageId } : {}),
      }),
    onSuccess: () => {
      setContent('');
      setIsInternal(false);
      setMentioningMessage(null);
      shouldAutoScrollNextRef.current = true;
      nextScrollBehaviorRef.current = 'smooth';
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void loadLatestMessages(true);
    },
    onError: () => toast.error(t('chat.send') + ' — erro'),
  });

  const resolveMutation = useMutation({
    mutationFn: () => omnichannelApi.resolve(conversationId),
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

  const endHelpMutation = useMutation({
    mutationFn: () => omnichannelApi.endHelp(conversationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId, 'helpers'] });
      toast.success(t('help.endHelp'));
    },
    onError: () => toast.error('Erro ao encerrar ajuda'),
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
      stickToBottomRef.current = false;
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
    sendMutation.mutate({
      text,
      isInternalMessage: isInternal,
      mentionMessageId: mentioningMessage?.message_id ?? null,
    });
  }

  function resizeComposer() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  const updateShortcutSuggestions = useCallback((value: string) => {
    if (!value.startsWith('/')) {
      setShowShortcutSuggestions(false);
      setShortcutSuggestions([]);
      setSelectedShortcutIndex(0);
      return;
    }

    const search = value.slice(1).trim().toLowerCase();
    const filtered = quickReplies.filter((reply) =>
      reply.shortcut.toLowerCase().includes(search) ||
      reply.title.toLowerCase().includes(search),
    );

    setShortcutSuggestions(filtered);
    setSelectedShortcutIndex(0);
    setShowShortcutSuggestions(filtered.length > 0);
  }, [quickReplies]);

  useEffect(() => {
    if (!content.startsWith('/')) return;
    updateShortcutSuggestions(content);
  }, [content, quickReplies, updateShortcutSuggestions]);

  function applyQuickReply(reply: QuickReply) {
    const resolved = resolveVariables(reply.content, {
      contactName: data?.conversation?.contact_name ?? data?.conversation?.client_name ?? '',
      organizationName: data?.conversation?.organization_name ?? '',
      protocolNumber: data?.conversation?.protocol_number ?? '',
      agentName: currentUserName ?? '',
    });

    applyComposerText(resolved);
    setShowQuickReplies(false);
    setShowShortcutSuggestions(false);
    setShortcutSuggestions([]);
    setSelectedShortcutIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showShortcutSuggestions && shortcutSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedShortcutIndex((prev) => (prev + 1) % shortcutSuggestions.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedShortcutIndex((prev) => (prev - 1 + shortcutSuggestions.length) % shortcutSuggestions.length);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setShowShortcutSuggestions(false);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        applyQuickReply(shortcutSuggestions[selectedShortcutIndex]!);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleContentChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setContent(value);
    resizeComposer();
    updateShortcutSuggestions(value);
  }

  function applyComposerText(text: string) {
    setContent(text);
    setShowShortcutSuggestions(false);
    setShortcutSuggestions([]);
    setSelectedShortcutIndex(0);
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      resizeComposer();
    });
  }

  function handleMentionMessage(message: Message, senderLabel: string) {
    if (message.sender_type === 'system') return;
    const mediaSubtype = (
      message.metadata
      && typeof message.metadata === 'object'
      && 'media_subtype' in message.metadata
      && typeof (message.metadata as Record<string, unknown>).media_subtype === 'string'
    )
      ? String((message.metadata as Record<string, unknown>).media_subtype)
      : null;
    setMentioningMessage({
      message_id: message.id,
      sender_type: message.sender_type,
      sender_label: senderLabel,
      content: buildMentionPreview(message.content, message.content_type),
      content_type: message.content_type,
      external_id: null,
      media_id: extractMessageMediaId(message),
      media_subtype: mediaSubtype,
    });

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function appendEmojiToComposer(emoji: string) {
    applyComposerText(`${content}${emoji}`);
    setShowEmojiPicker(false);
  }

  async function copyProtocol(protocolNumber: string) {
    try {
      await navigator.clipboard.writeText(protocolNumber);
      toast.success('Protocolo copiado!');
    } catch {
      toast.error('Não foi possível copiar o protocolo');
    }
  }

  async function handleAssume() {
    if (!currentUserId) return;
    setIsAssuming(true);
    try {
      const updated = await omnichannelApi.assign(conversationId, currentUserId);

      // Usa dados reais do DB (retornados com JOIN pela rota) para atualizar o cache
      qc.setQueryData(
        ['conversation', conversationId],
        (old: { conversation: Conversation; messages: OmnichannelMessage[] } | undefined) => {
          if (!old) return old;
          return { ...old, conversation: updated as Conversation };
        },
      );

      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
      window.dispatchEvent(new CustomEvent('omnichannel:conversation-assumed', {
        detail: { conversationId },
      }));
      toast.success('Atendimento assumido!');
    } catch {
      toast.error('Erro ao assumir atendimento');
    } finally {
      setIsAssuming(false);
    }
  }

  const conv = data?.conversation as Conversation | undefined;
  const isResolved = conv?.status === 'resolved' || conv?.status === 'closed';
  const isUnassigned = !conv?.assigned_to;
  const isAssignedToMe = !!conv?.assigned_to && conv.assigned_to === currentUserId;
  const isAssignedToOther = !!conv?.assigned_to && conv.assigned_to !== currentUserId;
  const acceptedHelpers = helpers.filter((helper) => helper.status === 'accepted');
  const isHelper = acceptedHelpers.some((helper) => helper.helper_user_id === currentUserId);
  const helperIndicator = acceptedHelpers[0] ?? null;
  const isOwnerOrAdmin = ['owner', 'admin'].includes(currentUserRole ?? '');
  const canSendMessage = (isAssignedToMe || isHelper) && !isResolved;
  const canAssume = isUnassigned && !isResolved;
  const canTransfer = (isAssignedToMe || isOwnerOrAdmin) && !isResolved;
  const isComposerAttachmentActive = isMediaActive || isAudioActive;
  const displayName = conv?.contact_name ?? conv?.client_name ?? 'Visitante';
  const organizationName = (
    conv?.organization_name
    ?? (conv?.contact_name && conv?.client_name && conv.client_name !== conv.contact_name ? conv.client_name : null)
  )?.trim() ?? null;
  const avatarName = conv?.contact_name ?? conv?.client_name ?? null;
  const chBadge = CH_BADGE[conv?.channel_type ?? ''];
  const statusStyle = STATUS_STYLE[conv?.status ?? ''];
  const channelLabel = conv?.channel_type === 'whatsapp' ? 'WhatsApp' : conv?.channel_type === 'email' ? 'E-mail' : 'Chat';
  const hasTypedContent = content.trim().length > 0;

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
          padding: '8px 20px',
          minHeight: 68,
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
              background: avatarGradient(avatarName),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              title={organizationName ? `${displayName} | ${organizationName}` : displayName}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--txt)',
                  whiteSpace: 'nowrap',
                }}
              >
                {displayName}
              </span>
              {organizationName && (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--txt-3)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  | {organizationName}
                </span>
              )}
            </div>
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
              {conv?.protocol_number && (
                <button
                  type="button"
                  title="Número do protocolo"
                  onClick={() => void copyProtocol(conv.protocol_number!)}
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--txt-3)',
                    background: 'var(--bg-4)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-pill)',
                    padding: '2px 8px',
                    transition: 'all .15s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.color = 'var(--teal)';
                    event.currentTarget.style.borderColor = 'rgba(0,201,167,.22)';
                    event.currentTarget.style.background = 'var(--teal-dim)';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.color = 'var(--txt-3)';
                    event.currentTarget.style.borderColor = 'var(--line)';
                    event.currentTarget.style.background = 'var(--bg-4)';
                  }}
                >
                  📋 {conv.protocol_number}
                </button>
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
              {helperIndicator && (
                <div className="helper-indicator">
                  <span>{helperIndicator.helper_name ?? t('help.helping')}</span>
                  <span>{t('help.helping')}</span>
                  <button
                    type="button"
                    onClick={() => endHelpMutation.mutate()}
                    disabled={endHelpMutation.isPending}
                    style={{
                      border: '1px solid rgba(167,139,250,.3)',
                      background: 'transparent',
                      color: 'inherit',
                      borderRadius: 'var(--r-pill)',
                      padding: '2px 8px',
                      fontSize: 11,
                      cursor: endHelpMutation.isPending ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {t('help.endHelp')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {canAssume ? (
            <button
              onClick={() => void handleAssume()}
              disabled={isAssuming}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 'var(--r)',
                background: 'var(--teal)',
                border: 'none',
                color: '#0a1a18',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--font)',
                cursor: isAssuming ? 'not-allowed' : 'pointer',
                opacity: isAssuming ? 0.6 : 1,
                transition: 'all .15s',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M1.5 13c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              {isAssuming ? 'Assumindo...' : 'Assumir atendimento'}
            </button>
          ) : (
            <>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="tb-icon-btn"
                  onClick={() => setShowTagDropdown((value) => !value)}
                  title={t('tags.manage', { defaultValue: 'Gerenciar etiquetas' })}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path
                      d="M1.5 1.5h5l6 6-5 5-6-6v-5z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <circle cx="4.5" cy="4.5" r="1" fill="currentColor" />
                  </svg>
                </button>

                {showTagDropdown && (
                  <TagDropdown
                    conversationId={conversationId}
                    onClose={() => setShowTagDropdown(false)}
                  />
                )}
              </div>

              {isHelper && !isAssignedToMe && (
                <span className="helper-indicator">{t('help.helping')}</span>
              )}

              {canTransfer && (
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
              )}

              {isAssignedToMe && !isResolved && (
                <button
                  type="button"
                  className="tb-icon-btn"
                  onClick={() => setShowHelpModal(true)}
                  title={t('help.request')}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
                    <path
                      d="M5.5 5.5C5.5 4.7 6.1 4 7 4s1.5.6 1.5 1.5c0 .7-.4 1.2-1 1.5C7 7.3 7 7.7 7 8"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <circle cx="7" cy="10" r=".6" fill="currentColor" />
                  </svg>
                </button>
              )}

              {isAssignedToMe && !isResolved && (
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

              {isAssignedToMe && !isResolved && (
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
            </>
          )}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          ref={messagesContainerRef}
          onScroll={syncBottomAnchor}
          style={{
            height: '100%',
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
                const isAgent = msg.sender_type === 'agent';
                const isBot = msg.sender_type === 'bot';
                const isSystem = msg.sender_type === 'system';
                const isCallRecording = msg.content_type === 'call_recording';
                const callRecordingMeta = parseCallRecordingMetadata(msg);
                const isCompanySide = isAgent || isBot;
                const hideAudioLabel = msg.content_type === 'audio' && msg.sender_type === 'client';
                const showMessageContent = Boolean(msg.content) && !hideAudioLabel && !isCallRecording;
                const agentDisplayName = conv?.assigned_name ?? currentUserName ?? 'Sem agente';
                const contactDisplayName = displayName;
                const organizationDisplayName = (
                  conv?.organization_name
                  ?? (conv?.contact_name && conv?.client_name && conv.client_name !== conv.contact_name ? conv.client_name : null)
                )?.trim();
                const clientLabel = organizationDisplayName
                  ? `${contactDisplayName} - ${organizationDisplayName}`
                  : contactDisplayName;
                const senderLabel = isSystem
                  ? 'Sistema'
                  : isBot
                    ? '🤖 Bot'
                    : isAgent
                      ? agentDisplayName
                      : clientLabel;
                const senderLabelColor = isSystem
                  ? 'var(--txt-3)'
                  : isBot
                    ? 'var(--purple)'
                    : isAgent
                      ? 'var(--teal)'
                      : 'var(--txt-3)';
                const mention = msg.metadata?.mention ?? null;
                const canMentionThisMessage = canSendMessage && !msg.is_internal;

                if (isSystem && !isCallRecording) {
                  return (
                    <div
                      key={msg.id}
                      style={{
                        textAlign: 'center',
                        fontStyle: 'italic',
                        fontSize: 12,
                        color: 'var(--txt-3)',
                        padding: '4px 16px',
                        background: 'var(--bg-3)',
                        borderRadius: 'var(--r-pill)',
                        margin: '8px auto',
                        maxWidth: 360,
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.5,
                      }}
                    >
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
                      justifyContent: 'flex-start',
                      flexDirection: isCompanySide ? 'row-reverse' : 'row',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: isBot
                          ? 'var(--purple-dim)'
                          : isAgent
                            ? 'linear-gradient(135deg,var(--teal),#00A88C)'
                            : avatarGradient(avatarName),
                        border: isBot ? '1px solid rgba(167,139,250,.3)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 600,
                        color: isBot ? 'var(--purple)' : '#fff',
                        flexShrink: 0,
                        marginBottom: 2,
                      }}
                    >
                      {isBot ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <rect x="3" y="5" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
                          <rect x="6" y="2" width="4" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
                          <circle cx="6" cy="9" r="1" fill="currentColor" />
                          <circle cx="10" cy="9" r="1" fill="currentColor" />
                          <path d="M6 11.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                          <path d="M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      ) : isAgent ? (
                        (conv?.assigned_name ?? 'A').charAt(0).toUpperCase()
                      ) : (
                        displayName.charAt(0).toUpperCase()
                      )}
                    </div>

                    <div style={{ maxWidth: '65%', display: 'flex', flexDirection: 'column', alignItems: isCompanySide ? 'flex-end' : 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '0.02em',
                            color: senderLabelColor,
                            alignSelf: isCompanySide ? 'flex-end' : 'flex-start',
                            maxWidth: '100%',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={senderLabel}
                        >
                          {senderLabel}
                        </span>
                        {canMentionThisMessage && (
                          <button
                            type="button"
                            onClick={() => handleMentionMessage(msg, senderLabel)}
                            title="Mencionar mensagem"
                            style={{
                              border: '1px solid var(--line)',
                              background: 'var(--bg-4)',
                              color: 'var(--txt-3)',
                              borderRadius: 999,
                              padding: '1px 6px',
                              fontSize: 10,
                              cursor: 'pointer',
                              lineHeight: 1.5,
                            }}
                          >
                            ↩
                          </button>
                        )}
                      </div>
                      <div
                        style={{
                          padding: '9px 13px',
                          borderRadius: 12,
                          borderTopLeftRadius: isCompanySide ? 12 : 0,
                          borderTopRightRadius: isCompanySide ? 0 : 12,
                          fontSize: 13,
                          lineHeight: 1.55,
                          wordBreak: 'break-word',
                          background: msg.is_internal
                            ? 'var(--amber-dim)'
                            : isAgent
                              ? 'linear-gradient(135deg,#0f5a50,#0b4740)'
                              : isBot
                                ? 'rgba(139, 92, 246, 0.12)'
                                : 'var(--bg-3)',
                          color: msg.is_internal ? 'var(--amber)' : isAgent ? '#eafff9' : 'var(--txt)',
                          border: msg.is_internal
                            ? '1px solid rgba(245,158,11,.3)'
                            : isAgent
                              ? '1px solid rgba(0,201,167,.28)'
                              : isBot
                                ? '1px solid rgba(139, 92, 246, 0.2)'
                                : '1px solid var(--line-2)',
                        }}
                      >
                        {mention && (
                          <div
                            style={{
                              marginBottom: 7,
                              padding: '6px 8px',
                              borderLeft: '3px solid rgba(0,201,167,.65)',
                              background: 'rgba(0,0,0,.12)',
                              borderRadius: 8,
                            }}
                          >
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--teal)', marginBottom: 2 }}>
                              {mention.sender_label}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {mention.media_id && mention.content_type === 'image' && (
                                <MentionMediaThumb
                                  conversationId={conversationId}
                                  mediaId={mention.media_id}
                                />
                              )}
                              <div style={{ fontSize: 12, opacity: 0.9, whiteSpace: 'pre-wrap' }}>
                                {mention.content_type === 'text' ? mention.content : mentionTypeLabel(mention)}
                              </div>
                            </div>
                          </div>
                        )}
                        {msg.is_internal && (
                          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {t('chat.internalNote')}
                          </div>
                        )}
                        {isCallRecording && callRecordingMeta ? (
                          <div className="call-recording-msg">
                            <div className="recording-icon">📞</div>
                            <div className="recording-info">
                              <span className="recording-label">Gravação da chamada</span>
                              <span className="recording-duration">
                                {formatCallRecordingDuration(callRecordingMeta.duration)}
                              </span>
                            </div>
                            <audio controls src={callRecordingMeta.recording_url}>
                              <source src={callRecordingMeta.recording_url} />
                            </audio>
                          </div>
                        ) : null}
                        {msg.content_type !== 'text' && !isCallRecording && (
                          <div style={{ marginBottom: showMessageContent ? 6 : 0 }}>
                            <MessageMedia
                              message={msg}
                              conversationId={conversationId}
                              localMediaUrl={msg.media_url ? localMediaUrls[msg.media_url] : undefined}
                            />
                          </div>
                        )}
                        {showMessageContent
                          ? msg.content_type === 'text'
                            ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                            : msg.content
                          : null}
                      </div>
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 10,
                          fontFamily: 'var(--mono)',
                          color: 'var(--txt-3)',
                          textAlign: isCompanySide ? 'right' : 'left',
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
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarGradient(avatarName), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
              {displayName.charAt(0).toUpperCase()}
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

        {unseenMessageCount > 0 && (
          <button
            type="button"
            onClick={() => jumpToLatestMessages('smooth')}
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 18,
              transform: 'translateX(-50%)',
              zIndex: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 14px',
              borderRadius: 'var(--r-pill)',
              border: '1px solid rgba(0,201,167,.28)',
              background: 'rgba(9,20,19,.96)',
              color: 'var(--teal)',
              boxShadow: '0 10px 24px rgba(0,0,0,.28)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
            }}
          >
            <span aria-hidden>↓</span>
            {unseenMessageCount === 1 ? '1 nova mensagem' : `${unseenMessageCount} novas mensagens`}
          </button>
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
              mentionMessageId={mentioningMessage?.message_id ?? null}
              onActiveChange={setIsMediaActive}
              onSent={async (payload) => {
                registerLocalMediaPreview(payload);
                setMentioningMessage(null);
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
              mentionMessageId={mentioningMessage?.message_id ?? null}
              onActiveChange={setIsAudioActive}
              onSent={async (payload) => {
                registerLocalMediaPreview(payload);
                setMentioningMessage(null);
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
              ⚡ {tAdmin('tenantAdmin.quickReplies.chat.title')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {quickReplies.length > 0 ? quickReplies.map((reply) => (
                <button
                  key={reply.id}
                  type="button"
                  onClick={() => applyQuickReply(reply)}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--teal)',
                        background: 'var(--teal-dim)',
                        borderRadius: 999,
                        padding: '2px 7px',
                      }}
                    >
                      /{reply.shortcut}
                    </span>
                    <span style={{ fontWeight: 500 }}>{reply.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--txt-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {highlightQuickReplyVariables(reply.content)}
                  </div>
                </button>
              )) : (
                <div style={{ padding: '12px', fontSize: 12, color: 'var(--txt-3)' }}>
                  {tAdmin('tenantAdmin.quickReplies.noReplies')}
                </div>
              )}
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
              <>
                {mentioningMessage && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      marginBottom: 8,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(0,201,167,.25)',
                      background: 'rgba(0,201,167,.08)',
                    }}
                  >
                    <div style={{ width: 3, borderRadius: 999, background: 'var(--teal)', alignSelf: 'stretch' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 600, marginBottom: 2 }}>
                        Respondendo {mentioningMessage.sender_label}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {mentioningMessage.media_id && mentioningMessage.content_type === 'image' && (
                          <MentionMediaThumb
                            conversationId={conversationId}
                            mediaId={mentioningMessage.media_id}
                          />
                        )}
                        <div style={{ fontSize: 12, color: 'var(--txt-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {mentioningMessage.content_type === 'text' ? mentioningMessage.content : mentionTypeLabel(mentioningMessage)}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMentioningMessage(null)}
                      title="Remover menção"
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: '1px solid var(--line)',
                        background: 'var(--bg-3)',
                        color: 'var(--txt-2)',
                        cursor: 'pointer',
                        lineHeight: 1,
                        fontSize: 14,
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 8,
                    background: isInternal ? 'rgba(245,158,11,.08)' : 'var(--bg-3)',
                    border: `1px solid ${isInternal ? 'rgba(245,158,11,.3)' : 'var(--line-2)'}`,
                    borderRadius: 12,
                    padding: '10px 10px 10px 12px',
                  }}
                >
                {showShortcutSuggestions && shortcutSuggestions.length > 0 && !isComposerAttachmentActive ? (
                  <div
                    ref={shortcutDropdownRef}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 'calc(100% + 10px)',
                      background: 'var(--bg-2)',
                      border: '1px solid var(--line-2)',
                      borderRadius: 14,
                      boxShadow: '0 -4px 20px rgba(0,0,0,.3)',
                      maxHeight: 280,
                      overflowY: 'auto',
                      zIndex: 30,
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--line)',
                        fontSize: 12,
                        color: 'var(--txt-3)',
                      }}
                    >
                      {tAdmin('tenantAdmin.quickReplies.chat.search')}
                    </div>
                    {shortcutSuggestions.map((reply, index) => {
                      const isActive = index === selectedShortcutIndex;
                      return (
                        <button
                          key={reply.id}
                          type="button"
                          onClick={() => applyQuickReply(reply)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '10px 14px',
                            cursor: 'pointer',
                            border: 'none',
                            borderBottom: index === shortcutSuggestions.length - 1 ? 'none' : '1px solid var(--line)',
                            background: isActive ? 'var(--bg-3)' : 'transparent',
                            transition: 'background .15s',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--mono)',
                              fontSize: 12,
                              fontWeight: 600,
                              color: 'var(--teal)',
                              background: 'var(--teal-dim)',
                              padding: '2px 7px',
                              borderRadius: 999,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            /{reply.shortcut}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', whiteSpace: 'nowrap' }}>
                            {reply.title}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--txt-3)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              flex: 1,
                            }}
                          >
                            {highlightQuickReplyVariables(reply.content)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

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
              </>
            ) : isUnassigned ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  background: 'var(--bg-2)',
                  borderTop: '1px solid var(--line)',
                  borderRadius: 12,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: 'var(--bg-4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--txt-3)',
                    flexShrink: 0,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                    <circle cx="10" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M3 18c0-3.9 3.1-7 7-7s7 3.1 7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', marginBottom: 2 }}>
                    Nenhum agente responsável
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                    Assuma o atendimento para enviar mensagens
                  </div>
                </div>
                <button
                  onClick={() => void handleAssume()}
                  disabled={isAssuming}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 'var(--r)',
                    background: 'var(--teal)',
                    border: 'none',
                    color: '#0a1a18',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'var(--font)',
                    cursor: isAssuming ? 'not-allowed' : 'pointer',
                    opacity: isAssuming ? 0.6 : 1,
                    flexShrink: 0,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M1.5 13c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  {isAssuming ? 'Assumindo...' : 'Assumir atendimento'}
                </button>
              </div>
            ) : isAssignedToOther && !isResolved && !isHelper ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  background: 'var(--bg-2)',
                  borderTop: '1px solid var(--line)',
                  borderRadius: 12,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: 'var(--bg-4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--amber)',
                    flexShrink: 0,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                    <path d="M10 3v8M10 14v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', marginBottom: 2 }}>
                    Em atendimento por {conv?.assigned_name ?? 'outro agente'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                    Você pode visualizar mas não enviar mensagens
                  </div>
                </div>
                {isOwnerOrAdmin && (
                  <button
                    onClick={() => setShowTransferModal(true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 14px',
                      borderRadius: 'var(--r)',
                      background: 'var(--bg-4)',
                      border: '1px solid var(--line-2)',
                      color: 'var(--txt-2)',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'var(--font)',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Transferir para mim
                  </button>
                )}
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
                <span>Este atendimento foi encerrado</span>
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
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)' }}>
                {isComposerAttachmentActive
                  ? t('media.caption')
                  : showShortcutSuggestions
                  ? tAdmin('tenantAdmin.quickReplies.chat.hint')
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
        onConfirm={async () => {
          await resolveMutation.mutateAsync();
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

      {showHelpModal && (
        <RequestHelpModal
          conversationId={conversationId}
          {...(currentUserId ? { currentUserId } : {})}
          onClose={() => setShowHelpModal(false)}
          onRequested={async () => {
            await qc.invalidateQueries({ queryKey: ['conversation', conversationId, 'helpers'] });
          }}
        />
      )}
    </div>
  );
}
