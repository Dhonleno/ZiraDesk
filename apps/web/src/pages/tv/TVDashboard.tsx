import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import {
  omnichannelApi,
  type OmnichannelConversation,
  type TvAgentCard,
  type TvDashboardData,
  type TvConversationCard,
} from '../../services/api';
import { subscribeToEvent } from '../../services/socket';
import { useAuthStore } from '../../stores/auth.store';
import { usePermission } from '../../hooks/usePermission';

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

function CounterCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
        padding: '10px 12px',
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
      <div style={{ fontFamily: 'var(--mono)', fontSize: 32, fontWeight: 500, lineHeight: 1, color }}>
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
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { role } = usePermission();
  const canAccessTv = ['owner', 'admin', 'supervisor'].includes(role ?? '');
  const [now, setNow] = useState(new Date());
  const [dashboard, setDashboard] = useState<TvDashboardData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  useEffect(() => {
    if (!data) return;
    setDashboard(data);
  }, [data]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

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
        gridTemplateRows: '48px auto auto auto minmax(0, 1fr)',
        gap: 12,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <strong style={{ fontSize: 22, fontWeight: 600, color: 'var(--txt)', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            {t('tv.title')}
          </strong>
          <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('tv.subtitle')}</span>
        </div>
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
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
        <CounterCard label={t('tv.offline')} value={String(offlineCount)} color="var(--txt-2)" />
        <CounterCard label={t('tv.online')} value={String(onlineCount)} color="var(--teal)" />
        <CounterCard label={t('tv.available')} value={String(availableCount)} color="var(--teal)" />
        <CounterCard label={t('tv.inService')} value={String(inServiceCount)} color="#F59E0B" />
        <CounterCard label={t('tv.paused')} value={String(pausedCount)} color="#EF4444" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <CounterCard label={t('tv.queued')} value={String(queuedCount)} color="#EF4444" />
        <CounterCard label={t('tv.inService')} value={String(inServiceConvCount)} color="#F59E0B" />
        <CounterCard label={t('tv.resolvedToday')} value={String(resolvedToday)} color="var(--teal)" />
        <CounterCard label={t('tv.abandoned')} value={String(abandoned)} color="var(--txt-2)" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <CounterCard label={t('tv.tme')} value={formatMinutesMetric(dashboard.stats.tme)} color="var(--txt)" />
        <CounterCard label={t('tv.tma')} value={formatMinutesMetric(dashboard.stats.tma)} color="var(--txt)" />
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '10px 12px' }}>
          <div style={{ color: 'var(--txt-3)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            {t('tv.csat')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 32, lineHeight: 1, color: 'var(--txt)' }}>
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
          value={`${Math.round(dashboard.stats.sla)}%`}
          color={dashboard.stats.sla >= 80 ? 'var(--teal)' : dashboard.stats.sla >= 50 ? '#F59E0B' : '#EF4444'}
        />
      </section>

      <section style={{ minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <div style={{ minHeight: 0, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            {t('tv.inService')}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {inServiceConvs.map((card) => (
              <div key={card.id} style={{ background: 'rgba(0,201,167,0.08)', border: '1px solid var(--teal)', borderRadius: 'var(--r)', padding: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--teal)' }}>{card.protocol}</span>
                  {channelIcon(card.channelType)}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{card.contactName}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{card.contactPhone || '-'}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{card.agentName ?? '-'}</div>
                <ConversationChronometer baseTime={card.assignedAt ?? card.createdAt} color="var(--teal)" />
              </div>
            ))}
            {inServiceConvs.length === 0 ? (
              <div
                style={{
                  border: '1px dashed var(--line-2)',
                  borderRadius: 'var(--r)',
                  minHeight: 96,
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--txt-3)',
                  fontSize: 12,
                  textAlign: 'center',
                  padding: 12,
                }}
              >
                {t('tv.emptyInService')}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ minHeight: 0, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            {t('tv.queued')}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {queuedConvs.map((card) => (
              <div key={card.id} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid #EF4444', borderRadius: 'var(--r)', padding: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#EF4444' }}>{card.protocol}</span>
                  {channelIcon(card.channelType)}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{card.contactName}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{card.contactPhone || '-'}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)', marginBottom: 2 }}>{t('tv.waiting')}</div>
                <ConversationChronometer baseTime={card.queueEnteredAt ?? card.createdAt} color="#EF4444" />
              </div>
            ))}
          </div>
        </div>

        <div style={{ minHeight: 0, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            {t('tv.paused')}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {pausedAgents.map((agent) => (
              <div key={agent.id} style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid #F59E0B', borderRadius: 'var(--r)', padding: 9 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{agent.name}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{agent.pauseReason ?? '-'}</div>
                <span style={{ fontFamily: 'var(--mono)', color: '#F59E0B', fontSize: 12 }}>
                  {agent.pauseStartedAt
                    ? formatHhMmSs(diffSecondsFrom(agent.pauseStartedAt))
                    : (agent.pauseDuration ?? '00:00:00')}
                </span>
              </div>
            ))}
            {pausedAgents.length === 0 ? (
              <div
                style={{
                  border: '1px dashed var(--line-2)',
                  borderRadius: 'var(--r)',
                  minHeight: 96,
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--txt-3)',
                  fontSize: 12,
                  textAlign: 'center',
                  padding: 12,
                }}
              >
                {t('tv.emptyPaused')}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ minHeight: 0, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-2)', padding: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            {t('tv.available')}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {availableAgents.map((agent) => (
              <div key={agent.id} style={{ background: 'rgba(0,201,167,0.05)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 9 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{agent.name}</div>
                <div style={{ fontSize: 12, color: 'var(--teal)' }}>{t('tv.available_status')}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
