import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import {
  omnichannelApi,
  type MonitorBotConversation,
  type OmnichannelConversation,
  type TvAgentCard,
  type TvDashboardData,
  type TvConversationCard,
} from '../../services/api';
import { subscribeToEvent } from '../../services/socket';
import { useAuthStore } from '../../stores/auth.store';
import { useToast } from '../../stores/toast.store';
import { usePermission } from '../../hooks/usePermission';
import { BotConversationDrawer } from '../../components/omnichannel/BotConversationDrawer';

const BOT_STUCK_THRESHOLD_MINUTES = 10;

interface AgentEventPayload {
  userId?: string;
  reason?: string;
  startedAt?: string;
}

interface ConversationCreatedPayload {
  conversationId?: string;
  contactName?: string;
  conversation?: Partial<OmnichannelConversation> & { id?: string };
}

interface ConversationAssignedPayload {
  conversationId?: string;
}

interface ConversationResolvedPayload {
  conversationId?: string;
}

interface ConversationUpdatedPayload {
  conversationId?: string;
  status?: string;
  assigned_to?: string | null;
  assigned_name?: string | null;
  queue_entered_at?: string | null;
  conversation?: Partial<OmnichannelConversation> & { id?: string };
}

function channelIcon(type: string) {
  if (type === 'whatsapp') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--teal)' }}>
        <path d="M5 11.5a7 7 0 0 1 7-7h.1a7 7 0 0 1 7 7v.1a7 7 0 0 1-7 7H8l-3 2 .8-3.2A6.9 6.9 0 0 1 5 11.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.2 9.8c.2-.2.5-.2.7 0l.9.9c.2.2.2.5 0 .7l-.4.5c.5.9 1.2 1.6 2.1 2.1l.5-.4c.2-.2.5-.2.7 0l.9.9c.2.2.2.5 0 .7l-.6.6c-.4.4-.9.5-1.4.4a7.2 7.2 0 0 1-5.8-5.8c-.1-.5 0-1 .4-1.4l.6-.6z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'instagram') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--teal)' }}>
        <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="17.2" cy="6.8" r="1" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  if (type === 'email') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--teal)' }}>
        <rect x="3.5" y="6" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 8l7 5 7-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--teal)' }}>
      <path d="M5 11.5a7 7 0 0 1 7-7h.1a7 7 0 0 1 7 7v.1a7 7 0 0 1-7 7H8l-3 2 .8-3.2A6.9 6.9 0 0 1 5 11.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatHhMmSs(value: number): string {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function diffSecondsFrom(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

function formatMinutesMetric(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  if (safe < 60) return `${safe}min`;
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${hours}h ${minutes}m`;
}

function formatBotDuration(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  if (safe < 60) return `${safe}min`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${hours}h ${rest}min`;
}

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}

function truncateText(value: string | null | undefined, max = 60): string {
  const text = value?.trim();
  if (!text) return '-';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function formatRelativeTime(iso: string | null | undefined, now: Date, language: string): string {
  if (!iso) return '-';
  const minutes = minutesSince(iso, now);
  if (minutes < 1) {
    if (language.startsWith('en')) return 'now';
    if (language.startsWith('es')) return 'ahora';
    return 'agora';
  }
  if (minutes < 60) {
    if (language.startsWith('en')) return `${minutes}min ago`;
    if (language.startsWith('es')) return `hace ${minutes}min`;
    return `há ${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const value = rest > 0 ? `${hours}h ${rest}min` : `${hours}h`;
  if (language.startsWith('en')) return `${value} ago`;
  if (language.startsWith('es')) return `hace ${value}`;
  return `há ${value}`;
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDateLabel(date: Date, locale: string): string {
  const raw = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function deriveConversationCounts(cards: TvConversationCard[]): { queued: number; inService: number } {
  const queued = cards.filter((card) => !card.agentName && Boolean(card.queueEnteredAt) && card.status !== 'resolved' && card.status !== 'closed').length;
  const inService = cards.filter((card) => Boolean(card.agentName) && card.status !== 'resolved' && card.status !== 'closed').length;
  return { queued, inService };
}

function deriveAgentSummary(cards: TvAgentCard[]): TvDashboardData['agents'] {
  return {
    offline: cards.filter((card) => card.status === 'offline').length,
    online: cards.filter((card) => card.status === 'online' || card.status === 'paused').length,
    available: cards.filter((card) => card.status === 'online' && card.isAvailable && card.activeConversations === 0).length,
    inService: cards.filter((card) => card.status === 'online' && card.activeConversations > 0).length,
    paused: cards.filter((card) => card.status === 'paused').length,
  };
}

function patchAgentStatus(
  card: TvAgentCard,
  status: TvAgentCard['status'],
  extra?: Partial<TvAgentCard>,
): TvAgentCard {
  return {
    ...card,
    status,
    ...(extra ?? {}),
  };
}

function toCardFromConversation(payload: Partial<OmnichannelConversation> & { id?: string }): TvConversationCard | null {
  if (!payload.id) return null;
  const createdAt = payload.created_at ?? new Date().toISOString();
  return {
    id: payload.id,
    protocol: payload.protocol_number ?? payload.id.slice(0, 12).toUpperCase(),
    channelType: payload.channel_type ?? 'unknown',
    contactName: payload.contact_name ?? '-',
    contactPhone: payload.contact_whatsapp ?? payload.contact_phone ?? '',
    agentName: payload.assigned_name ?? null,
    assignedAt: payload.assigned_at ?? null,
    createdAt,
    status: payload.status ?? 'open',
    waitTime: null,
    queueEnteredAt: payload.queue_entered_at ?? null,
  };
}

function BotIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="6" y="10" width="20" height="16" rx="5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 10V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16" cy="5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13" cy="18" r="1.4" fill="currentColor" />
      <circle cx="19" cy="18" r="1.4" fill="currentColor" />
      <path d="M13 22h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CounterCard({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
        padding: '12px 14px',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          color: 'var(--txt-3)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', lineHeight: 1, color }}>
        {value}
      </div>
    </div>
  );
}

function ConversationChronometer({
  baseTime,
  color,
}: {
  baseTime: string;
  color: string;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = () => setSeconds(diffSecondsFrom(baseTime));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [baseTime]);

  return (
    <span style={{ fontFamily: 'var(--mono)', color, fontSize: 12 }}>
      {formatHhMmSs(seconds)}
    </span>
  );
}

export function TVDashboard() {
  const { t, i18n } = useTranslation('omnichannel');
  const toast = useToast();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { role } = usePermission();
  const canAccessTv = ['owner', 'admin', 'supervisor'].includes(role ?? '');
  const [now, setNow] = useState(new Date());
  const [dashboard, setDashboard] = useState<TvDashboardData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<'realtime' | 'bot'>('realtime');
  const [botAction, setBotAction] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<MonitorBotConversation | null>(null);
  const [closingBotConversation, setClosingBotConversation] = useState<MonitorBotConversation | null>(null);
  const [closeMessage, setCloseMessage] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dateLabel = formatDateLabel(now, i18n.language || 'pt-BR');

  const { data } = useQuery({
    queryKey: ['tv-dashboard'],
    queryFn: omnichannelApi.tv,
    enabled: isAuthenticated && canAccessTv,
    staleTime: 0,
    refetchInterval: 30_000,
    retry: (failureCount, error) => {
      const statusCode = (error as { response?: { status?: number } })?.response?.status;
      if (statusCode === 403) return false;
      return failureCount < 1;
    },
  });

  const { data: botData, refetch: refetchBot, isFetching: isFetchingBot } = useQuery({
    queryKey: ['monitor-bot'],
    queryFn: omnichannelApi.monitorBot,
    enabled: isAuthenticated && canAccessTv,
    staleTime: 0,
    refetchInterval: 30_000,
    retry: (failureCount, error) => {
      const statusCode = (error as { response?: { status?: number } })?.response?.status;
      if (statusCode === 403) return false;
      return failureCount < 1;
    },
  });

  useEffect(() => {
    if (!data) return;
    setDashboard(data);
  }, [data]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setSelectedConversation(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!selectedConversation || !botData) return;
    const stillInBot = botData.conversations.some((conversation) => conversation.id === selectedConversation.id);
    if (!stillInBot) setSelectedConversation(null);
  }, [botData, selectedConversation]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // browser bloqueou ou não suporta fullscreen
    }
  };

  const pullBotConversation = async (conversationId: string): Promise<boolean> => {
    setBotAction(`pull:${conversationId}`);
    try {
      await omnichannelApi.pullMonitorBotConversation(conversationId);
      toast.success(t('monitor.bot.pullSuccess'));
      await refetchBot();
      return true;
    } catch {
      toast.error(t('monitor.bot.actionError'));
      return false;
    } finally {
      setBotAction(null);
    }
  };

  const closeBotConversation = async (): Promise<boolean> => {
    if (!closingBotConversation) return false;
    const conversationId = closingBotConversation.id;
    setBotAction(`close:${conversationId}`);
    try {
      await omnichannelApi.closeMonitorBotConversation(conversationId, closeMessage);
      toast.success(t('monitor.bot.closeSuccess'));
      setClosingBotConversation(null);
      setCloseMessage('');
      await refetchBot();
      return true;
    } catch {
      toast.error(t('monitor.bot.actionError'));
      return false;
    } finally {
      setBotAction(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        const isTypingContext = tag === 'input' || tag === 'textarea' || target.isContentEditable;
        if (isTypingContext) return;
      }

      event.preventDefault();
      void toggleFullscreen();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribeToEvent<AgentEventPayload>('agent:online', (payload) => {
        if (!payload.userId) return;
        setDashboard((current) => {
          if (!current) return current;
          const cards = current.agentCards.map((card) => (
            card.id === payload.userId
              ? patchAgentStatus(card, 'online', { pauseReason: null, pauseStartedAt: null, pauseDuration: null, isAvailable: true })
              : card
          ));
          return { ...current, agentCards: cards, agents: deriveAgentSummary(cards) };
        });
      }),
      subscribeToEvent<AgentEventPayload>('agent:offline', (payload) => {
        if (!payload.userId) return;
        setDashboard((current) => {
          if (!current) return current;
          const cards = current.agentCards.map((card) => (
            card.id === payload.userId
              ? patchAgentStatus(card, 'offline', { pauseReason: null, pauseStartedAt: null, pauseDuration: null, activeConversations: 0, isAvailable: false })
              : card
          ));
          return { ...current, agentCards: cards, agents: deriveAgentSummary(cards) };
        });
      }),
      subscribeToEvent<AgentEventPayload>('agent:paused', (payload) => {
        if (!payload.userId) return;
        setDashboard((current) => {
          if (!current) return current;
          const cards = current.agentCards.map((card) => (
            card.id === payload.userId
              ? patchAgentStatus(card, 'paused', {
                pauseReason: payload.reason ?? card.pauseReason,
                pauseStartedAt: payload.startedAt ?? card.pauseStartedAt ?? new Date().toISOString(),
                pauseDuration: null,
                isAvailable: false,
              })
              : card
          ));
          return { ...current, agentCards: cards, agents: deriveAgentSummary(cards) };
        });
      }),
      subscribeToEvent<AgentEventPayload>('agent:resumed', (payload) => {
        if (!payload.userId) return;
        setDashboard((current) => {
          if (!current) return current;
          const cards = current.agentCards.map((card) => (
            card.id === payload.userId
              ? patchAgentStatus(card, 'online', { pauseReason: null, pauseStartedAt: null, pauseDuration: null, isAvailable: true })
              : card
          ));
          return { ...current, agentCards: cards, agents: deriveAgentSummary(cards) };
        });
      }),
      subscribeToEvent<ConversationCreatedPayload>('conversation:created', (payload) => {
        setDashboard((current) => {
          if (!current) return current;
          const fromConversation = payload.conversation ? toCardFromConversation(payload.conversation) : null;
          const id = fromConversation?.id ?? payload.conversationId;
          if (!id) return current;

          const existing = current.conversationCards.some((card) => card.id === id);
          const card = fromConversation ?? {
            id,
            protocol: id.slice(0, 12).toUpperCase(),
            channelType: 'unknown',
            contactName: payload.contactName ?? '-',
            contactPhone: '',
            agentName: null,
            assignedAt: null,
            createdAt: new Date().toISOString(),
            status: 'open',
            waitTime: null,
            queueEnteredAt: null,
          };
          const cards = existing
            ? current.conversationCards.map((item) => (item.id === id ? { ...item, ...card } : item))
            : [card, ...current.conversationCards];
          const counts = deriveConversationCounts(cards);
          return {
            ...current,
            conversationCards: cards,
            conversations: { ...current.conversations, queued: counts.queued, inService: counts.inService },
          };
        });
      }),
      subscribeToEvent<ConversationAssignedPayload>('conversation:assigned', (payload) => {
        if (!payload.conversationId) return;
        setDashboard((current) => {
          if (!current) return current;
          const cards = current.conversationCards.map((card) => (
            card.id === payload.conversationId
              ? { ...card, assignedAt: card.assignedAt ?? new Date().toISOString(), queueEnteredAt: null, status: 'open' }
              : card
          ));
          const counts = deriveConversationCounts(cards);
          return {
            ...current,
            conversationCards: cards,
            conversations: { ...current.conversations, queued: counts.queued, inService: counts.inService },
          };
        });
      }),
      subscribeToEvent<ConversationResolvedPayload>('conversation:resolved', (payload) => {
        if (!payload.conversationId) return;
        setDashboard((current) => {
          if (!current) return current;
          const cards = current.conversationCards.filter((card) => card.id !== payload.conversationId);
          const counts = deriveConversationCounts(cards);
          return {
            ...current,
            conversationCards: cards,
            conversations: {
              ...current.conversations,
              queued: counts.queued,
              inService: counts.inService,
              resolvedToday: current.conversations.resolvedToday + 1,
            },
          };
        });
      }),
      subscribeToEvent<ConversationUpdatedPayload>('conversation:updated', (payload) => {
        const id = payload.conversation?.id ?? payload.conversationId;
        if (!id) return;
        setDashboard((current) => {
          if (!current) return current;

          const patch = payload.conversation ? toCardFromConversation(payload.conversation) : null;
          const status = payload.status ?? patch?.status;
          if (status === 'closed' || status === 'resolved') {
            const cards = current.conversationCards.filter((card) => card.id !== id);
            const counts = deriveConversationCounts(cards);
            return {
              ...current,
              conversationCards: cards,
              conversations: {
                ...current.conversations,
                queued: counts.queued,
                inService: counts.inService,
                resolvedToday: status === 'resolved'
                  ? current.conversations.resolvedToday + 1
                  : current.conversations.resolvedToday,
                abandoned: status === 'closed'
                  ? current.conversations.abandoned + 1
                  : current.conversations.abandoned,
              },
            };
          }

          const cards = current.conversationCards.map((card) => {
            if (card.id !== id) return card;
            const assignedAt = patch?.assignedAt
              ?? card.assignedAt
              ?? (payload.assigned_to ? new Date().toISOString() : null);
            return {
              ...card,
              ...(patch ?? {}),
              assignedAt,
              agentName: payload.assigned_name ?? patch?.agentName ?? card.agentName,
              queueEnteredAt: payload.assigned_to
                ? null
                : (payload.queue_entered_at ?? patch?.queueEnteredAt ?? card.queueEnteredAt),
              status: status ?? card.status,
            };
          });
          const counts = deriveConversationCounts(cards);
          return {
            ...current,
            conversationCards: cards,
            conversations: { ...current.conversations, queued: counts.queued, inService: counts.inService },
          };
        });
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, []);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessTv) {
    return <Navigate to="/omnichannel/conversations" replace />;
  }

  if (!dashboard) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--txt-2)',
          fontFamily: 'var(--font)',
        }}
      >
        {t('myStats.loading')}
      </div>
    );
  }

  const agentCards = dashboard.agentCards;
  const conversationCards = dashboard.conversationCards;

  const inServiceAgents = agentCards.filter(
    (card) => card.status === 'online' && card.activeConversations > 0,
  );
  const pausedAgents = agentCards.filter((card) => card.status === 'paused');
  const availableAgents = agentCards.filter(
    (card) => card.status === 'online' && card.isAvailable && card.activeConversations === 0,
  );

  const offlineCount = agentCards.filter((card) => card.status === 'offline').length;
  const onlineCount = agentCards.filter((card) => card.status === 'online' || card.status === 'paused').length;
  const availableCount = availableAgents.length;
  const inServiceCount = inServiceAgents.length;
  const pausedCount = pausedAgents.length;

  const inServiceConvs = conversationCards.filter(
    (card) => Boolean(card.agentName) && card.status !== 'resolved' && card.status !== 'closed',
  );
  const queuedConvs = conversationCards.filter(
    (card) => !card.agentName && Boolean(card.queueEnteredAt) && card.status !== 'resolved' && card.status !== 'closed',
  );

  const queuedCount = queuedConvs.length;
  const inServiceConvCount = inServiceConvs.length;
  const resolvedToday = data?.conversations?.resolvedToday ?? 0;
  const abandoned = data?.conversations?.abandoned ?? 0;
  const hasCsat = (dashboard.stats.csat ?? 0) > 0;
  const slaEmpty = dashboard.stats.sla === 0 && queuedCount + inServiceConvCount + resolvedToday + abandoned === 0;
  const botConversations = botData?.conversations ?? [];
  const botTotal = botData?.total ?? botConversations.length;
  const botStuck = botConversations.filter(
    (conversation) => minutesSince(conversation.created_at, now) > BOT_STUCK_THRESHOLD_MINUTES,
  ).length;
  const botGridTemplateRows = activeTab === 'realtime'
    ? 'auto auto auto auto minmax(0, 1fr)'
    : 'auto minmax(0, 1fr)';

  return (
    <div
      ref={containerRef}
      style={{
        background: 'var(--bg)',
        padding: '16px 24px',
        height: '100%',
        overflow: 'hidden',
        fontFamily: 'var(--font)',
        color: 'var(--txt)',
        display: 'grid',
        gridTemplateRows: botGridTemplateRows,
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <nav
          aria-label={t('monitor.tabs')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            width: 'max-content',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r)',
            background: 'var(--bg-2)',
            padding: 3,
          }}
        >
          {([
            ['realtime', t('monitor.realtimeTab')],
            ['bot', t('monitor.bot.tab')],
          ] as const).map(([tab, label]) => {
            const selected = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  border: '1px solid transparent',
                  borderRadius: 'var(--r)',
                  background: selected ? 'var(--bg-3)' : 'transparent',
                  color: selected ? 'var(--txt)' : 'var(--txt-2)',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 24, color: 'var(--teal)' }}>{formatClock(now)}</div>
            <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{dateLabel}</div>
          </div>
          <button
            type="button"
            onClick={() => { void toggleFullscreen(); }}
            title={`${isFullscreen ? t('tv.exitFullscreen') : t('tv.enterFullscreen')} (F)`}
            aria-label={`${isFullscreen ? t('tv.exitFullscreen') : t('tv.enterFullscreen')} (F)`}
            aria-keyshortcuts="F"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 'var(--r)',
              border: '1px solid var(--line-2)',
              background: 'var(--bg-3)',
              color: 'var(--txt-2)',
              cursor: 'pointer',
            }}
          >
            {isFullscreen ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 2H2v3M9 2h3v3M2 9v3h3M12 9v3H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 1H1v4M9 1h4v4M1 9v4h4M13 9v4H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'realtime' ? (
        <>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 14 }}>
        <CounterCard label={t('tv.offline')} value={String(offlineCount)} color="var(--txt-2)" />
        <CounterCard label={t('tv.online')} value={String(onlineCount)} color="var(--green)" />
        <CounterCard label={t('tv.available')} value={String(availableCount)} color="var(--green)" />
        <CounterCard label={t('tv.inService')} value={String(inServiceCount)} color="var(--teal)" />
        <CounterCard label={t('tv.paused')} value={String(pausedCount)} color="var(--amber)" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 14 }}>
        <CounterCard label={t('tv.queued')} value={String(queuedCount)} color="var(--red)" />
        <CounterCard label={t('tv.inService')} value={String(inServiceConvCount)} color="var(--teal)" />
        <CounterCard label={t('tv.resolvedToday')} value={String(resolvedToday)} color="var(--teal)" />
        <CounterCard label={t('tv.abandoned')} value={String(abandoned)} color="var(--txt-2)" />
        <CounterCard label={t('monitor.bot.cardLabel')} value={String(botTotal)} color="var(--txt-2)" onClick={() => setActiveTab('bot')} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        <CounterCard label={t('tv.tme')} value={formatMinutesMetric(dashboard.stats.tme)} color="var(--txt)" />
        <CounterCard label={t('tv.tma')} value={formatMinutesMetric(dashboard.stats.tma)} color="var(--txt)" />
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
          <div style={{ color: 'var(--txt-3)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            {t('tv.csat')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', lineHeight: 1, color: hasCsat ? 'var(--amber)' : 'var(--txt-3)' }}>
              {hasCsat ? dashboard.stats.csat.toFixed(1) : '—'}
            </span>
            {hasCsat ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--amber)' }}>
                <path d="M12 3.8l2.5 5.1 5.6.8-4.1 4 1 5.7-5-2.6-5 2.6 1-5.7-4.1-4 5.6-.8L12 3.8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            ) : null}
          </div>
        </div>
        <CounterCard
          label={t('tv.sla')}
          value={slaEmpty ? '—' : `${Math.round(dashboard.stats.sla)}%`}
          color={slaEmpty ? 'var(--txt-3)' : dashboard.stats.sla >= 80 ? 'var(--teal)' : dashboard.stats.sla >= 50 ? 'var(--amber)' : 'var(--red)'}
        />
      </section>

      <section style={{ minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 200, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 14px 8px' }}>
            {t('tv.inService')}
          </div>
          <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
            {inServiceConvs.map((card) => (
              <div key={card.id} style={{ background: 'var(--teal-dim)', border: '1px solid rgba(0, 201, 167, 0.25)', borderRadius: 'var(--r)', padding: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--teal)' }}>{card.protocol}</span>
                  {channelIcon(card.channelType)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}>{card.contactName}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{card.contactPhone || '-'}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{card.agentName ?? '-'}</div>
                <ConversationChronometer baseTime={card.assignedAt ?? card.createdAt} color="var(--teal)" />
              </div>
            ))}
            {inServiceConvs.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '24px 0',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>{t('tv.emptyInService')}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 200, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 14px 8px' }}>
            {t('tv.queued')}
          </div>
          <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
            {queuedConvs.map((card) => (
              <div key={card.id} style={{ background: 'var(--red-dim)', border: '1px solid rgba(248, 113, 113, 0.25)', borderRadius: 'var(--r)', padding: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)' }}>{card.protocol}</span>
                  {channelIcon(card.channelType)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}>{card.contactName}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{card.contactPhone || '-'}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)', marginBottom: 2 }}>{t('tv.waiting')}</div>
                <ConversationChronometer baseTime={card.queueEnteredAt ?? card.createdAt} color="var(--red)" />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 200, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 14px 8px' }}>
            {t('tv.paused')}
          </div>
          <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
            {pausedAgents.map((agent) => (
              <div key={agent.id} style={{ background: 'var(--amber-dim)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 'var(--r)', padding: 9 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}>{agent.name}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{agent.pauseReason ?? '-'}</div>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber)', fontSize: 12 }}>
                  {agent.pauseStartedAt
                    ? formatHhMmSs(diffSecondsFrom(agent.pauseStartedAt))
                    : (agent.pauseDuration ?? '00:00:00')}
                </span>
              </div>
            ))}
            {pausedAgents.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '24px 0',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>{t('tv.emptyPaused')}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 200, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 14px 8px' }}>
            {t('tv.available')}
          </div>
          <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
            {availableAgents.map((agent) => (
              <div key={agent.id} style={{ background: 'var(--teal-dim)', border: '1px solid rgba(0, 201, 167, 0.25)', borderRadius: 'var(--r)', padding: 9 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}>{agent.name}</div>
                <div style={{ fontSize: 11, color: 'var(--green)' }}>{t('tv.available_status')}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
        </>
      ) : (
        <section
          style={{
            minHeight: 0,
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr)',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              padding: '10px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  color: 'var(--txt-2)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  padding: '4px 8px',
                }}
              >
                {t('monitor.bot.total', { count: botTotal })}
              </span>
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  color: botStuck > 0 ? 'var(--red)' : 'var(--txt-2)',
                  background: botStuck > 0 ? 'var(--red-dim)' : 'var(--bg-3)',
                  border: `1px solid ${botStuck > 0 ? 'var(--red)' : 'var(--line-2)'}`,
                  borderRadius: 'var(--r)',
                  padding: '4px 8px',
                }}
              >
                {t('monitor.bot.stuck', { count: botStuck })} {t('monitor.bot.stuckThreshold', { minutes: BOT_STUCK_THRESHOLD_MINUTES })}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { void refetchBot(); }}
              disabled={isFetchingBot}
              style={{
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                background: 'var(--bg-3)',
                color: 'var(--txt)',
                fontSize: 12,
                fontWeight: 600,
                padding: '7px 10px',
                cursor: isFetchingBot ? 'wait' : 'pointer',
                opacity: isFetchingBot ? 0.7 : 1,
              }}
            >
              {t('monitor.bot.refresh')}
            </button>
          </div>

          <div
            style={{
              minHeight: 0,
              overflow: 'auto',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
            }}
          >
            {botConversations.length === 0 ? (
              <div
                style={{
                  minHeight: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--txt-2)',
                  padding: 24,
                  textAlign: 'center',
                }}
              >
                <div style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--txt-3)' }}>
                    <BotIcon />
                  </span>
                  <strong style={{ color: 'var(--txt)', fontSize: 15 }}>{t('monitor.bot.emptyTitle')}</strong>
                  <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('monitor.bot.emptySubtitle')}</span>
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-3)', zIndex: 1 }}>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: 'var(--txt-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('monitor.bot.contact')}</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: 'var(--txt-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('monitor.bot.phone')}</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: 'var(--txt-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('monitor.bot.channel')}</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: 'var(--txt-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('monitor.bot.timeInBot')}</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: 'var(--txt-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('monitor.bot.lastMessage')}</th>
                    <th style={{ textAlign: 'right', padding: '9px 10px', color: 'var(--txt-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('monitor.bot.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {botConversations.map((conversation) => {
                    const liveMinutes = minutesSince(conversation.created_at, now);
                    const isStuck = liveMinutes > BOT_STUCK_THRESHOLD_MINUTES;
                    const phone = conversation.contact_whatsapp ?? conversation.contact_phone ?? '-';
                    const actionPull = botAction === `pull:${conversation.id}`;
                    const actionClose = botAction === `close:${conversation.id}`;
                    return (
                      <tr
                        key={conversation.id}
                        style={{
                          background: isStuck ? 'var(--red-dim)' : 'transparent',
                          boxShadow: isStuck ? 'inset 2px 0 0 var(--red)' : 'inset 0 -1px 0 var(--line)',
                        }}
                      >
                        <td style={{ padding: '10px', color: 'var(--txt)', verticalAlign: 'top' }}>
                          <div style={{ display: 'grid', gap: 2 }}>
                            <strong style={{ fontSize: 13, fontWeight: 600 }}>{conversation.contact_name ?? '-'}</strong>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)' }}>
                              {conversation.protocol_number ?? conversation.id.slice(0, 12).toUpperCase()}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '10px', color: 'var(--txt-2)', verticalAlign: 'top', fontFamily: 'var(--mono)' }}>{phone}</td>
                        <td style={{ padding: '10px', color: 'var(--txt-2)', verticalAlign: 'top' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {channelIcon(conversation.channel_type)}
                            {conversation.channel_name ?? conversation.channel_type}
                          </span>
                        </td>
                        <td style={{ padding: '10px', verticalAlign: 'top' }}>
                          <span style={{ fontFamily: 'var(--mono)', color: isStuck ? 'var(--red)' : 'var(--txt)', fontWeight: 600 }}>
                            {formatBotDuration(liveMinutes)}
                          </span>
                        </td>
                        <td style={{ padding: '10px', color: 'var(--txt-2)', verticalAlign: 'top', maxWidth: 320 }}>
                          <div style={{ display: 'grid', gap: 2 }}>
                            <span>{truncateText(conversation.last_message)}</span>
                            <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                              {formatRelativeTime(conversation.last_message_at, now, i18n.language || 'pt-BR')}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '10px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <button
                              type="button"
                              className="tb-icon-btn"
                              onClick={() => setSelectedConversation(conversation)}
                              title={t('monitor.bot.viewConversation')}
                              aria-label={t('monitor.bot.viewConversation')}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                              >
                                <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
                                <circle cx="8" cy="8" r="2.5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => { void pullBotConversation(conversation.id); }}
                              disabled={Boolean(botAction)}
                              style={{
                                border: '1px solid var(--teal)',
                                borderRadius: 'var(--r)',
                                background: 'var(--teal)',
                                color: 'var(--on-teal)',
                                fontSize: 12,
                                fontWeight: 600,
                                padding: '6px 9px',
                                cursor: botAction ? 'wait' : 'pointer',
                              }}
                            >
                              {actionPull ? t('monitor.bot.loading') : t('monitor.bot.pull')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setClosingBotConversation(conversation);
                                setCloseMessage('');
                              }}
                              disabled={Boolean(botAction)}
                              style={{
                                border: '1px solid var(--red)',
                                borderRadius: 'var(--r)',
                                background: 'var(--red-dim)',
                                color: 'var(--red)',
                                fontSize: 12,
                                fontWeight: 600,
                                padding: '6px 9px',
                                cursor: botAction ? 'wait' : 'pointer',
                              }}
                            >
                              {actionClose ? t('monitor.bot.loading') : t('monitor.bot.close')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      <BotConversationDrawer
        conversation={selectedConversation}
        onClose={() => setSelectedConversation(null)}
        onPull={async (conversationId) => {
          const success = await pullBotConversation(conversationId);
          if (success) setSelectedConversation(null);
          return success;
        }}
        onClose_={(conversationId) => {
          const conversation = selectedConversation?.id === conversationId
            ? selectedConversation
            : botConversations.find((item) => item.id === conversationId) ?? null;
          if (!conversation) return false;
          setSelectedConversation(null);
          setClosingBotConversation(conversation);
          setCloseMessage('');
          return false;
        }}
      />

      {closingBotConversation ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="monitor-bot-close-title"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            background: 'var(--backdrop)',
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: 'min(480px, 100%)',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--shadow-pop)',
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ display: 'grid', gap: 4 }}>
              <strong id="monitor-bot-close-title" style={{ fontSize: 16, color: 'var(--txt)' }}>
                {t('monitor.bot.confirmClose')}
              </strong>
              <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                {t('monitor.bot.confirmCloseMessage')}
              </span>
            </div>
            <textarea
              value={closeMessage}
              onChange={(event) => setCloseMessage(event.target.value)}
              placeholder={t('monitor.bot.closeMessagePlaceholder')}
              rows={4}
              style={{
                width: '100%',
                resize: 'vertical',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                background: 'var(--bg-3)',
                color: 'var(--txt)',
                fontFamily: 'var(--font)',
                fontSize: 13,
                padding: 10,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setClosingBotConversation(null);
                  setCloseMessage('');
                }}
                disabled={Boolean(botAction)}
                style={{
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  background: 'var(--bg-3)',
                  color: 'var(--txt)',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '8px 12px',
                  cursor: botAction ? 'wait' : 'pointer',
                }}
              >
                {t('monitor.bot.cancel')}
              </button>
              <button
                type="button"
                onClick={() => { void closeBotConversation(); }}
                disabled={Boolean(botAction)}
                style={{
                  border: '1px solid var(--red)',
                  borderRadius: 'var(--r)',
                  background: 'var(--red)',
                  color: 'var(--bg)',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '8px 12px',
                  cursor: botAction ? 'wait' : 'pointer',
                }}
              >
                {botAction?.startsWith('close:') ? t('monitor.bot.loading') : t('monitor.bot.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
