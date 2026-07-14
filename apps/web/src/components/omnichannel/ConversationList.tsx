import { useState, useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { api, conversationTags, omnichannelApi, type ConversationTag, type ListConversationsParams } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useNotification } from '../../hooks/useNotification';
import { subscribeToEvent } from '../../services/socket';
import { useToast } from '../../stores/toast.store';
import { useAuthStore } from '../../stores/auth.store';
import { useNotificationStore } from '../../stores/notification.store';
import { AgentStatsModal } from './AgentStatsModal';
import { avatarClass } from '../../utils/avatar';
import { notifySound, shouldShowDesktopNotification } from '../../utils/notify';

interface ConversationItem {
  id: string;
  status: string;
  channel_type: string;
  conversation_type: string | null;
  protocol_number?: string | null;
  subject: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  csat_score?: number | null;
  csat_comment?: string | null;
  csat_stage?: 'none' | 'sent' | 'waiting_comment' | 'done' | null;
  contact_name?: string | null;
  contact_email?: string | null;
  organization_name?: string | null;
  department_name?: string | null;
  assigned_to?: string | null;
  assigned_name: string | null;
  channel_name: string | null;
  metadata?: Record<string, unknown> | null;
  unread_count?: number;
  tags?: ConversationTag[];
}

interface SocketContactPayload {
  id?: string;
  name?: string | null;
}

interface SocketMessagePayload {
  sender_type?: string;
  senderType?: string;
  sender_id?: string | null;
  senderId?: string | null;
  content?: string | null;
}

interface SocketConversationPayload {
  id?: string;
  assigned_to?: string | null;
  assignedTo?: string | null;
  assignedAgentId?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  contact_name?: string | null;
  contactName?: string | null;
}

interface ConversationMessageEventPayload {
  conversationId?: string;
  message?: SocketMessagePayload;
  conversation?: SocketConversationPayload;
  contact?: SocketContactPayload;
  contactName?: string | null;
}

interface ConversationCreatedEventPayload {
  conversationId?: string;
  conversation?: SocketConversationPayload;
  contactName?: string | null;
}

const TABS = [
  { key: 'open', labelKey: 'tabs.open' },
  { key: 'waiting', labelKey: 'tabs.waiting' },
  { key: 'closed', labelKey: 'tabs.closed' },
] as const;

type TabKey = 'open' | 'waiting' | 'closed';

interface ConversationCounts {
  open: number;
  waiting: number;
  mine: number;
  closed: number;
}

interface ConversationListMeta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface ConversationListPage {
  data: ConversationItem[];
  meta: ConversationListMeta;
}

type ConversationCacheEntry = ConversationItem[] | { pages?: ConversationListPage[] };

function relativeTime(dateStr: string | null, nowLabel: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return nowLabel;
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function getMessageSenderType(message?: SocketMessagePayload): string | null {
  return message?.sender_type ?? message?.senderType ?? null;
}

function getMessageSenderId(message?: SocketMessagePayload): string | null {
  return message?.sender_id ?? message?.senderId ?? null;
}

/* channel badge */
const CH_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  whatsapp: {
    bg: 'var(--channel-whatsapp-dim)',
    color: 'var(--channel-whatsapp)',
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
  initialAgentId?: string;
}

export function ConversationList({ selectedId, onSelect, initialAgentId }: Props) {
  const { t } = useTranslation(['omnichannel', 'common']);
  const toast = useToast();
  const { showNotification } = useNotification();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('open');
  const [assignedToMe, setAssignedToMe] = useState(!initialAgentId);
  const [filterAgentId, setFilterAgentId] = useState(initialAgentId ?? '');
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
  const [showTagFilterDropdown, setShowTagFilterDropdown] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [newActivity, setNewActivity] = useState<Set<string>>(new Set());
  const [newConversations, setNewConversations] = useState<Set<string>>(new Set());
  const activityTimeoutsRef = useRef<Map<string, number>>(new Map());
  const newConversationTimeoutsRef = useRef<Map<string, number>>(new Map());
  const desktopPermissionDeniedRef = useRef(false);
  const tagFilterRef = useRef<HTMLDivElement | null>(null);
  const mainTabsRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const debouncedSearch = useDebounce(search, 300);
  const qc = useQueryClient();

  useEffect(() => {
    setFilterAgentId(initialAgentId ?? '');
    setAssignedToMe(!initialAgentId);
    setActiveTab('open');
  }, [initialAgentId]);

  const revealSelectedTab = useCallback((selector: string, container: HTMLDivElement | null) => {
    if (!container) return;
    const target = container.querySelector<HTMLButtonElement>(selector);
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    });
  }, []);

  useEffect(() => {
    revealSelectedTab(`button[data-tab-key="${activeTab}"]`, mainTabsRef.current);
  }, [activeTab, revealSelectedTab]);

  const clearTimer = useCallback((timers: Map<string, number>, id: string) => {
    const timer = timers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.delete(id);
    }
  }, []);

  const clearConversationHighlight = useCallback((conversationId: string) => {
    clearTimer(activityTimeoutsRef.current, conversationId);
    clearTimer(newConversationTimeoutsRef.current, conversationId);

    setNewActivity((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });

    setNewConversations((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
  }, [clearTimer]);

  const handleSelectConversation = useCallback((conversationId: string) => {
    clearConversationHighlight(conversationId);
    onSelect(conversationId);
  }, [clearConversationHighlight, onSelect]);

  const markConversationActivity = useCallback((conversationId: string) => {
    if (selectedId === conversationId) {
      clearConversationHighlight(conversationId);
      return;
    }

    setNewActivity((prev) => {
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
    window.requestAnimationFrame(() => {
      setNewActivity((prev) => {
        const next = new Set(prev);
        next.add(conversationId);
        return next;
      });
    });

    clearTimer(activityTimeoutsRef.current, conversationId);
    const timer = window.setTimeout(() => {
      setNewActivity((prev) => {
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });
      activityTimeoutsRef.current.delete(conversationId);
    }, 5000);
    activityTimeoutsRef.current.set(conversationId, timer);
  }, [clearConversationHighlight, clearTimer, selectedId]);

  const markNewConversation = useCallback((conversationId: string) => {
    if (selectedId === conversationId) {
      clearConversationHighlight(conversationId);
      return;
    }

    setNewConversations((prev) => {
      const next = new Set(prev);
      next.add(conversationId);
      return next;
    });

    markConversationActivity(conversationId);
    clearTimer(newConversationTimeoutsRef.current, conversationId);
    const timer = window.setTimeout(() => {
      setNewConversations((prev) => {
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });
      newConversationTimeoutsRef.current.delete(conversationId);
    }, 10_000);
    newConversationTimeoutsRef.current.set(conversationId, timer);
  }, [clearConversationHighlight, clearTimer, markConversationActivity, selectedId]);

  const getConversationFromCache = useCallback((conversationId?: string): ConversationItem | null => {
    if (!conversationId) return null;
    const cached = qc.getQueriesData<ConversationCacheEntry>({ queryKey: ['conversations'] });
    for (const [, cachedConversations] of cached) {
      if (!cachedConversations) continue;
      const conversations = Array.isArray(cachedConversations)
        ? cachedConversations
        : cachedConversations.pages?.flatMap((page) => page.data) ?? [];
      const found = conversations.find((item) => item.id === conversationId);
      if (found) return found;
    }
    return null;
  }, [qc]);

  const notifyPermissionDeniedOnce = useCallback(() => {
    if (desktopPermissionDeniedRef.current) return;
    desktopPermissionDeniedRef.current = true;
    toast.info(t('notifications.permissionDenied'));
  }, [t, toast]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!tagFilterRef.current) return;
      if (!tagFilterRef.current.contains(event.target as Node)) {
        setShowTagFilterDropdown(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    const onAssumed = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      setAssignedToMe(true);
      setActiveTab('open');
      if (detail?.conversationId) {
        handleSelectConversation(detail.conversationId);
      }
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
    };

    window.addEventListener('omnichannel:conversation-assumed', onAssumed);
    return () => window.removeEventListener('omnichannel:conversation-assumed', onAssumed);
  }, [handleSelectConversation, qc]);

  useEffect(() => {
    if (!selectedId) return;
    clearConversationHighlight(selectedId);
    useNotificationStore.getState().markConversationRead(selectedId);
  }, [clearConversationHighlight, selectedId]);

  useEffect(() => {
    const invalidateConversationData = () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
    };

    const syncToActiveTabForCurrentUser = (conversationId?: string) => {
      const shouldMoveToActive = activeTab === 'open' || selectedId === conversationId;
      if (!shouldMoveToActive) return;

      setAssignedToMe(true);
      setActiveTab('open');
      if (conversationId) {
        handleSelectConversation(conversationId);
      }
    };

    const isBrowserTabHidden = (): boolean => typeof document !== 'undefined' && document.hidden === true;

    const handleMessage = (data: ConversationMessageEventPayload) => {
      invalidateConversationData();
      const conversationId = data.conversationId;
      const message = data.message;
      const senderType = getMessageSenderType(message);
      const senderId = getMessageSenderId(message);
      const cachedConversation = getConversationFromCache(conversationId);
      const assignedAgentId =
        data.conversation?.assigned_to
        ?? data.conversation?.assignedTo
        ?? data.conversation?.assignedAgentId
        ?? cachedConversation?.assigned_to
        ?? null;
      const conversationStatus =
        data.conversation?.status
        ?? cachedConversation?.status
        ?? null;
      const csatStage = cachedConversation?.csat_stage ?? null;

      if (conversationId) {
        markConversationActivity(conversationId);
      }

      // Não tocar som/notificação se a conversa ainda está no bot.
      if (conversationStatus === 'bot') {
        return;
      }

      // Não tocar som/notificação durante interação de CSAT.
      if (csatStage && csatStage !== 'none') {
        return;
      }

      if (!currentUserId || assignedAgentId !== currentUserId) {
        return;
      }

      // Regra 2: não tocar som se a mensagem é do próprio agente logado.
      if (senderType === 'agent' && senderId && currentUserId && senderId === currentUserId) {
        return;
      }

      const isClientMessage = senderType === 'client';
      const isAssignedToCurrentUser = Boolean(currentUserId) && assignedAgentId === currentUserId;
      const shouldNotifyByAssignee = isAssignedToCurrentUser;

      // Regra final de som:
      // - mensagem do cliente
      // - conversa atribuída a mim OU em fila
      // - aba em foco (document.hidden === false)
      if (isClientMessage && shouldNotifyByAssignee && !isBrowserTabHidden()) {
        notifySound('message');
      }

      // Notificação de browser para mensagem nova na conversa do agente com aba fora de foco.
      if (isClientMessage && shouldNotifyByAssignee && isBrowserTabHidden()) {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission !== 'granted') {
          if (Notification.permission === 'denied') {
            notifyPermissionDeniedOnce();
          }
          return;
        }

        const contactName =
          data.contact?.name
          ?? data.contactName
          ?? data.conversation?.contact_name
          ?? data.conversation?.contactName
          ?? cachedConversation?.contact_name
          ?? t('notifications.newMessage');
        const content = message?.content?.trim() || t('notifications.newMessage');

        if (shouldShowDesktopNotification()) {
          showNotification(contactName, content, '/icon-192.png');
        }
      }

      // Bell notification: group by conversation; skip if conversation is currently open.
      if (
        isClientMessage
        && shouldNotifyByAssignee
        && conversationId
        && conversationId !== selectedId
      ) {
        const contactName =
          data.contact?.name
          ?? data.contactName
          ?? data.conversation?.contact_name
          ?? data.conversation?.contactName
          ?? cachedConversation?.contact_name
          ?? t('notifications.newMessage');
        const content = message?.content?.trim() || t('notifications.newMessage');
        useNotificationStore.getState().addMessage({
          conversationId,
          contactName,
          message: content,
          timestamp: new Date().toISOString(),
        });
      }
    };

    const handleCreated = (data: ConversationCreatedEventPayload) => {
      invalidateConversationData();
      const conversationId = data.conversationId ?? data.conversation?.id;

      if (conversationId) {
        markNewConversation(conversationId);
      }

    };

    const handleAssigned = (data: { conversationId?: string }) => {
      invalidateConversationData();
      const conversationId = data.conversationId;
      if (conversationId) {
        markNewConversation(conversationId);
      }
      syncToActiveTabForCurrentUser(conversationId);

      const alreadyViewing = conversationId && conversationId === selectedId;
      if (alreadyViewing) return;

      if (isBrowserTabHidden()) {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission !== 'granted') {
          if (Notification.permission === 'denied') {
            notifyPermissionDeniedOnce();
          }
          return;
        }
        const cachedConversation = getConversationFromCache(conversationId);
        const contactName =
          cachedConversation?.contact_name
          ?? t('notifications.newMessage');
        if (shouldShowDesktopNotification()) {
          showNotification(
            t('notifications.assigned'),
            `${contactName} ${t('notifications.assignedBody')}`,
            '/icon-192.png',
          );
        }
      } else {
        notifySound('assignment');
      }
    };

    const handleUpdated = (data: {
      conversationId?: string;
      assigned_to?: string | null;
      assignedTo?: string | null;
      assignedAgentId?: string | null;
      conversation?: {
        id?: string;
        assigned_to?: string | null;
        assignedTo?: string | null;
        assignedAgentId?: string | null;
      };
    }) => {
      invalidateConversationData();

      const conversationId = data.conversationId ?? data.conversation?.id;
      const assignedTo =
        data.assigned_to
        ?? data.assignedTo
        ?? data.assignedAgentId
        ?? data.conversation?.assigned_to
        ?? data.conversation?.assignedTo
        ?? data.conversation?.assignedAgentId
        ?? null;
      if (assignedTo === currentUserId) {
        syncToActiveTabForCurrentUser(conversationId);
      }
      if (assignedTo !== currentUserId && conversationId) {
        useNotificationStore.getState().markConversationRead(conversationId);
      }
    };

    const unsubMessage = subscribeToEvent<ConversationMessageEventPayload>('conversation:new_message', handleMessage);
    const unsubIncoming = subscribeToEvent<ConversationMessageEventPayload>('conversation:message', handleMessage);
    const unsubAssigned = subscribeToEvent<{ conversationId?: string }>('conversation:assigned', handleAssigned);
    const unsubUpdated = subscribeToEvent<{
      conversationId?: string;
      assigned_to?: string | null;
      assignedTo?: string | null;
      assignedAgentId?: string | null;
      conversation?: {
        id?: string;
        assigned_to?: string | null;
        assignedTo?: string | null;
        assignedAgentId?: string | null;
      };
    }>('conversation:updated', handleUpdated);
    const unsubCreated = subscribeToEvent<ConversationCreatedEventPayload>(
      'conversation:created',
      handleCreated,
    );
    const unsubTagAdded = subscribeToEvent<{ conversationId: string }>('conversation:tag_added', ({ conversationId }) => {
      invalidateConversationData();
      void qc.invalidateQueries({ queryKey: ['conversation-tags', conversationId] });
    });
    const unsubTagRemoved = subscribeToEvent<{ conversationId: string }>('conversation:tag_removed', ({ conversationId }) => {
      invalidateConversationData();
      void qc.invalidateQueries({ queryKey: ['conversation-tags', conversationId] });
    });
    const unsubCsatUpdated = subscribeToEvent<{ conversationId: string }>('conversation:csat_updated', () => {
      invalidateConversationData();
    });
    const unsubAgentRequeued = subscribeToEvent('agent:requeued', () => {
      invalidateConversationData();
    });
    return () => {
      unsubMessage();
      unsubIncoming();
      unsubAssigned();
      unsubUpdated();
      unsubCreated();
      unsubTagAdded();
      unsubTagRemoved();
      unsubCsatUpdated();
      unsubAgentRequeued();

      for (const timer of activityTimeoutsRef.current.values()) {
        window.clearTimeout(timer);
      }
      for (const timer of newConversationTimeoutsRef.current.values()) {
        window.clearTimeout(timer);
      }
      activityTimeoutsRef.current.clear();
      newConversationTimeoutsRef.current.clear();
    };
  }, [
    activeTab,
    currentUserId,
    getConversationFromCache,
    handleSelectConversation,
    markConversationActivity,
    markNewConversation,
    notifyPermissionDeniedOnce,
    qc,
    selectedId,
    showNotification,
    t,
  ]);

  const { data: counts } = useQuery({
    queryKey: ['conversation-counts'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: ConversationCounts }>('/omnichannel/conversations/counts');
      return res.data.data;
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['conversation-tags'],
    queryFn: () => conversationTags.listAvailable(),
    staleTime: 60_000,
  });

  const selectedTag = allTags.find((tag) => tag.id === filterTagId) ?? null;

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['conversations', activeTab, assignedToMe, debouncedSearch, filterTagId, filterAgentId],
    queryFn: async ({ pageParam }) => {
      const page = typeof pageParam === 'number' ? pageParam : 1;
      const params: ListConversationsParams = {
        page,
        perPage: 50,
        tab: activeTab,
      };

      if (activeTab === 'open' && !filterAgentId) {
        params.assigned_to_me = assignedToMe;
      }
      if (filterAgentId) {
        params.agent_id = filterAgentId;
      }
      if (debouncedSearch) {
        params.search = debouncedSearch;
      }
      if (filterTagId) {
        params.tag_id = filterTagId;
      }

      const result = await omnichannelApi.listConversationsPage(params);

      return result as ConversationListPage;
    },
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.meta;
      return page < totalPages ? page + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 30_000,
  });

  const assumeMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await api.post(`/omnichannel/queue/${conversationId}/assign-me`);
      return res.data;
    },
    onSuccess: (_data, conversationId) => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
      handleSelectConversation(conversationId);
      toast.success(t('chat.assumeSuccess'));
    },
    onError: () => toast.error(t('chat.assumeError')),
  });

  const conversations = data?.pages.flatMap((page) => page.data) ?? [];
  const count = conversations.length;
  const shouldVirtualizeConversations = !isLoading && conversations.length >= 50;
  const conversationVirtualizer = useVirtualizer({
    count: shouldVirtualizeConversations ? conversations.length : 0,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 88,
    measureElement: (element) => element?.getBoundingClientRect().height ?? 88,
    overscan: 5,
  });

  const renderConversationItem = useCallback((conv: ConversationItem) => {
    const isActive = selectedId === conv.id;
    const displayName = conv.contact_name ?? t('visitor');
    const organizationName = conv.organization_name?.trim() ?? null;
    const avatarName = conv.contact_name ?? null;
    const hasUnread = (conv.unread_count ?? 0) > 0;
    const hasNewActivity = newActivity.has(conv.id);
    const isNewConversation = newConversations.has(conv.id);
    const departmentName = conv.department_name?.trim() ?? null;
    const isAwaitingBotChoice = conv.metadata?.bot_stage === 'waiting_choice';
    const isAiAgentActive = conv.metadata?.ai_agent_active === true;
    const canAssumeConversation = activeTab === 'open' && !conv.assigned_to && !isAwaitingBotChoice && !isAiAgentActive;
    const itemClassName = [
      hasNewActivity ? 'zd-flash' : '',
      isNewConversation ? 'zd-slide-down' : '',
    ].filter(Boolean).join(' ');

    return (
      <div
        className={itemClassName}
        role="button"
        tabIndex={0}
        onClick={() => handleSelectConversation(conv.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelectConversation(conv.id);
          }
        }}
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
          borderTop: 'none',
          borderLeft: 'none',
          borderRight: 'none',
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-3)'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            className={avatarClass(avatarName ?? displayName)}
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <ChannelDot type={conv.channel_type} />
          {(hasNewActivity || isNewConversation) && (
            <span
              className="zd-pulse-dot"
              style={{ position: 'absolute', top: -2, right: -2, zIndex: 10 }}
            />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontSize: 13,
                fontWeight: hasUnread ? 600 : 500,
                color: 'var(--txt)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {displayName}
              </span>
              {organizationName && (
                <span
                  title={organizationName}
                  style={{
                    fontSize: 10,
                    color: 'var(--txt-3)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 150,
                  }}
                >
                  {organizationName}
                </span>
              )}
              {conv.protocol_number && (
                <span
                  title={conv.protocol_number}
                  style={{
                    fontSize: 10,
                    fontFamily: 'var(--mono)',
                    color: 'var(--txt-3)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {conv.protocol_number}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 6 }}>
              {isNewConversation && (
                <span className="zd-badge-new">{t('newBadge')}</span>
              )}
              {canAssumeConversation && (
                <button
                  type="button"
                  disabled={assumeMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    assumeMutation.mutate(conv.id);
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 'var(--r-pill)',
                    background: 'var(--teal-dim)',
                    border: '1px solid rgba(0,201,167,.25)',
                    color: 'var(--teal)',
                    cursor: assumeMutation.isPending ? 'wait' : 'pointer',
                    transition: 'all .15s',
                    whiteSpace: 'nowrap',
                    opacity: assumeMutation.isPending ? 0.7 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (assumeMutation.isPending) return;
                    e.currentTarget.style.background = 'var(--teal)';
                    e.currentTarget.style.color = 'var(--on-teal)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--teal-dim)';
                    e.currentTarget.style.color = 'var(--teal)';
                  }}
                >
                  {t('queue.assume')}
                </button>
              )}
              {hasUnread && (
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--teal)',
                  boxShadow: '0 0 0 2px var(--teal-dim)',
                }} />
              )}
              <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
                {relativeTime(conv.last_message_at ?? conv.created_at, t('now'))}
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

          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
            {conv.status === 'waiting' && conv.conversation_type === 'outbound' && (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--teal-dim)',
                color: 'var(--teal)',
                border: '1px solid rgba(0,201,167,.28)',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M2 8L8 2M8 2H4.5M8 2V5.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('outbound.badge')}
              </span>
            )}
            {conv.conversation_type === 'outbound' && conv.status !== 'waiting' && (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 'var(--r-pill)',
                background: 'rgba(245,158,11,.14)',
                color: 'var(--amber)',
                border: '1px solid rgba(245,158,11,.28)',
                whiteSpace: 'nowrap',
              }}>
                {t('outboundBadge')}
              </span>
            )}
            {departmentName && (
              <span style={{
                fontSize: 10,
                fontWeight: 500,
                padding: '1px 7px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--blue-dim)',
                color: 'var(--blue)',
                border: '1px solid rgba(96,165,250,.2)',
                whiteSpace: 'nowrap',
                maxWidth: 110,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {departmentName}
              </span>
            )}
            {activeTab === 'closed' && conv.csat_score ? (
              <span style={{
                fontSize: 10,
                color: 'var(--amber)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}>
                {Array.from({ length: conv.csat_score }).map((_, i) => (
                  <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                ))}
                {conv.csat_score}/5
              </span>
            ) : null}
          </div>

          {conv.tags && conv.tags.length > 0 && (
            <div className="conv-tags">
              {conv.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="conv-tag-chip"
                  style={{
                    background: `${tag.color}22`,
                    color: tag.color,
                    borderColor: `${tag.color}44`,
                  }}
                >
                  {tag.name}
                </span>
              ))}
              {conv.tags.length > 3 && (
                <span className="conv-tag-more">+{conv.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }, [
    activeTab,
    assumeMutation,
    handleSelectConversation,
    newActivity,
    newConversations,
    onSelect,
    selectedId,
    t,
  ]);

  return (
    <div style={{
      width: 320,
      minWidth: 320,
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
            <button
              onClick={() => setShowStats(true)}
              title={t('myStats.title')}
              aria-label={t('myStats.title')}
              style={{
                width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-4)', border: '1px solid var(--line)',
                borderRadius: 'var(--r)', cursor: 'pointer', color: 'var(--txt-2)',
                transition: 'all .15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--teal)';
                e.currentTarget.style.color = 'var(--teal)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--line)';
                e.currentTarget.style.color = 'var(--txt-2)';
              }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <rect x="1" y="6" width="2" height="4" rx="0.5" fill="currentColor" />
                <rect x="4.5" y="3.5" width="2" height="6.5" rx="0.5" fill="currentColor" />
                <rect x="8" y="1" width="2" height="9" rx="0.5" fill="currentColor" />
              </svg>
            </button>
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

        <div ref={tagFilterRef} style={{ marginTop: 8, position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowTagFilterDropdown((value) => !value)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: showTagFilterDropdown ? 'var(--bg-4)' : 'var(--bg-3)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
              padding: '6px 10px',
              cursor: 'pointer',
              color: 'var(--txt-2)',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'var(--font)',
            }}
          >
            <span>{t('tags.filter')}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 3h8L7 6.5v2L5 9V6.5L2 3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </button>

          {filterTagId && selectedTag && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  background: `${selectedTag.color}22`,
                  color: selectedTag.color,
                  border: `1px solid ${selectedTag.color}44`,
                  borderRadius: 'var(--r-pill)',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                }}
              >
                {selectedTag.name}
              </span>
              <button
                type="button"
                onClick={() => setFilterTagId(null)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--txt-3)',
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                }}
                title={t('tags.clearFilter')}
                aria-label={t('tags.clearFilter')}
              >
                ×
              </button>
            </div>
          )}

          {showTagFilterDropdown && (
            <div className="tag-dropdown" style={{ top: 'calc(100% + 6px)', left: 0, right: 0, minWidth: 0 }}>
              <div className="tag-dropdown-header">
                <span>{t('tags.title')}</span>
                <button type="button" onClick={() => setShowTagFilterDropdown(false)}>×</button>
              </div>
              <div className="tag-dropdown-list">
                {allTags.map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    className={`tag-option ${filterTagId === tag.id ? 'applied' : ''}`}
                    onClick={() => {
                      setFilterTagId((current) => (current === tag.id ? null : tag.id));
                      setShowTagFilterDropdown(false);
                    }}
                  >
                    <span className="tag-dot" style={{ background: tag.color }} />
                    <span className="tag-name">{tag.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {filterAgentId && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 10,
                border: '1px solid rgba(0,201,167,.25)',
                background: 'var(--teal-dim)',
                color: 'var(--teal)',
                borderRadius: 'var(--r-pill)',
                padding: '2px 8px',
              }}
            >
              {t('agentFilter')}
            </span>
            <button
              type="button"
              onClick={() => {
                setFilterAgentId('');
                setAssignedToMe(true);
              }}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--txt-3)',
                fontSize: 12,
              }}
            >
              {t('clear')}
            </button>
          </div>
        )}

        {activeTab === 'open' && !filterAgentId && (
          <button
            onClick={() => setAssignedToMe((v) => !v)}
            style={{
              marginTop: 8,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: assignedToMe ? 'var(--teal-dim)' : 'var(--bg-3)',
              border: `1px solid ${assignedToMe ? 'rgba(0,201,167,.25)' : 'var(--line)'}`,
              borderRadius: 'var(--r)',
              padding: '6px 10px',
              cursor: 'pointer',
              color: assignedToMe ? 'var(--teal)' : 'var(--txt-3)',
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
              {counts !== undefined && counts.mine > 0 && (
                <span style={{
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  padding: '0 5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,201,167,.14)',
                  color: 'var(--teal)',
                  fontSize: 10,
                  fontWeight: 600,
                }}>
                  {counts.mine}
                </span>
              )}
            </span>
            <div style={{
              width: 28, height: 16, borderRadius: 8,
              background: assignedToMe ? 'var(--teal)' : 'var(--bg-5)',
              position: 'relative', transition: 'background .15s',
            }}>
              <div style={{
                position: 'absolute', top: 2,
                left: assignedToMe ? 14 : 2,
                width: 12, height: 12, borderRadius: '50%',
                background: assignedToMe ? 'var(--on-teal)' : 'var(--txt-3)',
                transition: 'left .15s',
              }} />
            </div>
          </button>
        )}
      </div>

      {/* Main tabs */}
      <div
        className="omni-tabs-scroll"
        ref={mainTabsRef}
        style={{
        display: 'flex',
        flexWrap: 'nowrap',
        padding: '8px 14px',
        gap: 4,
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--bg-5) transparent',
      }}
      >
        {TABS.map((tab) => {
          const isAmberCounter = tab.key === 'waiting';
          const tabCount = counts?.[tab.key];
          return (
            <button
              key={tab.key}
              data-tab-key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--r-pill)',
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                flexShrink: 0,
                border: activeTab === tab.key ? '1px solid rgba(0,201,167,.2)' : '1px solid transparent',
                background: activeTab === tab.key ? 'var(--teal-dim)' : 'transparent',
                color: activeTab === tab.key ? 'var(--teal)' : 'var(--txt-3)',
                transition: 'all .15s',
              }}
            >
              {t(tab.labelKey)}
              {tabCount !== undefined && tabCount > 0 && (
                <span style={{
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  padding: '0 5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isAmberCounter ? 'rgba(245,158,11,.18)' : 'rgba(0,201,167,.14)',
                  color: isAmberCounter ? 'var(--amber)' : 'var(--teal)',
                  fontSize: 10,
                  fontWeight: 600,
                }}>
                  {tabCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div ref={listScrollRef} style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin' }}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ height: 12, width: 120, borderRadius: 4, background: 'var(--bg-4)', marginBottom: 8, animation: 'pulse 1.5s ease infinite' }} />
                <div style={{ height: 10, width: 180, borderRadius: 4, background: 'var(--bg-4)', animation: 'pulse 1.5s ease infinite' }} />
              </div>
            ))
          : conversations.length === 0
            ? (
                <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                    {t('noConversations')}
                  </div>
                </div>
              )
            : shouldVirtualizeConversations
              ? (
                  <div
                    style={{
                      height: conversationVirtualizer.getTotalSize(),
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {conversationVirtualizer.getVirtualItems().map((virtualRow) => {
                      const conversation = conversations[virtualRow.index];
                      if (!conversation) return null;
                      return (
                        <div
                          key={conversation.id}
                          data-index={virtualRow.index}
                          ref={conversationVirtualizer.measureElement}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {renderConversationItem(conversation)}
                        </div>
                      );
                    })}
                  </div>
                )
              : conversations.map((conv) => (
                  <div key={conv.id}>
                    {renderConversationItem(conv)}
                  </div>
                ))}
        {hasNextPage && (
          <button
            type="button"
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
            {isFetchingNextPage ? t('loading', { ns: 'common' }) : t('conversations.loadMore')}
          </button>
        )}
      </div>

      <AgentStatsModal open={showStats} onClose={() => setShowStats(false)} />
    </div>
  );
}
