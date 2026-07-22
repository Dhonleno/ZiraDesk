import { useEffect, useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useFaviconBadge } from '../hooks/useFaviconBadge';
import { adminApi, api, omnichannelApi, profileApi } from '../services/api';
import { connectSocket, disconnectSocket, setPresenceStatus, subscribeToEvent } from '../services/socket';
import { GlobalSearch } from '../components/ui/GlobalSearch';
import { NotificationCenter } from '../components/ui/NotificationCenter';
import { FloatingChatBubble } from '../components/ui/FloatingChatBubble';
import { OnboardingChecklist } from '../components/onboarding/OnboardingChecklist';
import { BrandLogo } from '../components/layout/BrandLogo';
import { LegalDpoLink } from '../components/legal/LegalDpoLink';
import { useAgentStatus } from '../hooks/useAgentStatus';
import { useNotification } from '../hooks/useNotification';
import { PauseModal } from '../components/omnichannel/PauseModal';
import { usePermission } from '../hooks/usePermission';
import { useToast } from '../stores/toast.store';
import { useNotificationStore } from '../stores/notification.store';
import { isConversationBotControlled } from '../utils/conversationNotifications';
import { notifySound, shouldShowDesktopNotification } from '../utils/notify';
import { useAuthStore, type AuthUser } from '../stores/auth.store';
import { PermissionGate } from '../components/ui/PermissionGate';

/* ── Theme toggle ─────────────────────────────────────────────────────────── */
function ThemeToggle() {
  const toggle = useCallback(() => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('zd-theme', next); } catch (_) {}
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'zd-theme' && e.newValue) {
        document.documentElement.setAttribute('data-theme', e.newValue);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <button onClick={toggle} className="tb-icon-btn theme-toggle" aria-label="Alternar tema">
      {/* Sun — shown in light mode */}
      <svg className="icon-sun" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      {/* Moon — shown in dark mode */}
      <svg className="icon-moon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

type SupportedLanguage = 'pt-BR' | 'en-US' | 'es';

const LANGUAGE_OPTIONS: Array<{
  value: SupportedLanguage;
  labelKey: string;
  flag: string;
}> = [
  { value: 'pt-BR', labelKey: 'language.ptBR', flag: '🇧🇷' },
  { value: 'en-US', labelKey: 'language.enUS', flag: '🇺🇸' },
  { value: 'es', labelKey: 'language.es', flag: '🇪🇸' },
];

const TITLE_UNREAD_PREFIX_RE = /^\(\d+\)\s*/;

function getCurrentZiraDeskTitle(): string {
  if (typeof document === 'undefined') return 'ZiraDesk';

  const cleanTitle = document.title.replace(TITLE_UNREAD_PREFIX_RE, '').trim();
  return cleanTitle.startsWith('ZiraDesk') ? cleanTitle : 'ZiraDesk';
}

function normalizeLanguage(value: string | undefined): SupportedLanguage {
  if (value === 'en-US' || value?.startsWith('en')) return 'en-US';
  if (value === 'es' || value?.startsWith('es')) return 'es';
  return 'pt-BR';
}

function LanguageSelector() {
  const { t, i18n } = useTranslation('common');
  const setUser = useAuthStore((state) => state.setUser);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeLanguage = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleSelect = (language: SupportedLanguage) => {
    setOpen(false);
    if (language !== activeLanguage) {
      void i18n.changeLanguage(language);
    }
    setUser({ language });
    void profileApi.update({ language })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      })
      .catch(() => {
        // A UI já trocou o idioma; localStorage fica como fallback até a próxima sincronização.
      });
  };

  return (
    <div className="language-selector" ref={menuRef}>
      <button
        type="button"
        className="tb-icon-btn"
        aria-label={t('language.label')}
        title={t('language.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d="M2.2 8h11.6M8 1.8c1.7 1.7 2.6 3.8 2.6 6.2s-.9 4.5-2.6 6.2C6.3 12.5 5.4 10.4 5.4 8S6.3 3.5 8 1.8Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="language-menu" role="menu" aria-label={t('language.label')}>
          {LANGUAGE_OPTIONS.map((option) => {
            const isActive = option.value === activeLanguage;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                className={`language-menu-item${isActive ? ' active' : ''}`}
                onClick={() => handleSelect(option.value)}
              >
                <span className="language-menu-label">
                  <span className="language-menu-flag" aria-hidden>{option.flag}</span>
                  {t(option.labelKey)}
                </span>
                {isActive && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M3 7.2l2.5 2.4L11 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Breadcrumb ───────────────────────────────────────────────────────────── */
function Breadcrumb() {
  const { t } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');
  const { pathname } = useLocation();

  const isCRM     = pathname.startsWith('/crm');
  const isConversations = pathname.startsWith('/omnichannel');
  const isAdmin   = pathname.startsWith('/admin');
  const isTickets = pathname.startsWith('/tickets');
  const isProfile = pathname.startsWith('/profile');

  const routeLabels: Record<string, string> = {
    '/home': tCommon('home.navLabel'),
    '/monitor': 'Monitor',
    '/omnichannel/monitor': 'Monitor',
    '/omnichannel/campaigns': 'Campanhas',
    '/omnichannel/metrics': 'Métricas',
    '/omnichannel/history': t('nav.history'),
    '/omnichannel/performance': t('nav.performance'),
    '/omnichannel/analyse': t('nav.analysis'),
    '/crm/organizations': 'Organizações',
    '/crm/contacts':      'Contatos',
    '/crm':               t('nav.crm'),
    '/tickets':           'Tickets',
    '/profile':           'Meu perfil',
    '/admin/users':       t('tenantAdmin.nav.users'),
    '/admin/roles':       t('roles.title'),
    '/admin/channels':    t('tenantAdmin.nav.channels'),
    '/admin/business-hours': t('tenantAdmin.nav.businessHours'),
    '/admin/voice-config': t('tenantAdmin.nav.voiceConfig'),
    '/admin/bot': t('tenantAdmin.nav.bot'),
    '/admin/auto-assign': t('tenantAdmin.nav.autoAssign'),
    '/admin/pause-reasons': t('tenantAdmin.nav.pauseReasons'),
    '/admin/quick-replies': t('tenantAdmin.nav.quickReplies'),
    '/admin/templates': t('tenantAdmin.nav.templates'),
    '/admin/ticket-types': t('tenantAdmin.nav.ticketTypes'),
    '/admin/conversation-tags': t('tenantAdmin.nav.conversationTags'),
    '/admin/close-config': t('tenantAdmin.closeConfig.title'),
    '/admin/lgpd': t('nav.lgpd'),
    '/admin/settings':    t('tenantAdmin.nav.settings'),
  };

  const staticLabel = routeLabels[pathname]
    ?? (pathname.startsWith('/monitor') || pathname.startsWith('/omnichannel/monitor')
      ? 'Monitor'
      : isConversations
        ? pathname.startsWith('/omnichannel/metrics')
          ? 'Métricas'
          : 'Central de Atendimento'
        : pathname.startsWith('/crm/organizations')
          ? 'Organizações'
          : pathname.startsWith('/crm/contacts')
            ? 'Contatos'
            : isTickets
              ? 'Tickets'
              : isProfile
                ? 'Meu perfil'
              : '');
  const section = isAdmin
    ? pathname === '/admin/close-config'
      ? 'Admin / Configurações'
      : 'Administração'
    : isCRM
      ? 'CRM'
      : isTickets
        ? 'Tickets'
        : isProfile
          ? 'Configurações'
          : 'Omnichannel';
  if (!staticLabel) return null;

  const iconEl = isCRM ? (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="5" r="2.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 12c0-2.5 2.2-4.2 5-4.2s5 1.7 5 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ) : isTickets ? (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1.5" y="2" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.5h6M4 8h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ) : isProfile ? (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7 1.8v1.1M7 11.1v1.1M12.2 7h-1.1M2.9 7H1.8M10.8 3.2l-.8.8M4 10l-.8.8M10.8 10.8l-.8-.8M4 4l-.8-.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 10V4.5L7 2l5 2.5V10H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--txt-3)', fontSize: 12 }}>
      {iconEl}
      <span>{section}</span>
      <span style={{ color: 'var(--txt-3)', margin: '0 1px' }}>/</span>
      <strong style={{ color: 'var(--txt)', fontWeight: 500 }}>{staticLabel}</strong>
    </div>
  );
}

/* ── Nav items ────────────────────────────────────────────────────────────── */
type NavItemProps = {
  to: string;
  end?: boolean;
  title: string;
  badge?: number;
  expanded?: boolean;
  children: React.ReactNode;
};

function NavItem({ to, end, title, badge, expanded = false, children }: NavItemProps) {
  const badgeValue = badge ?? 0;

  return (
    <NavLink
      to={to}
      {...(end ? { end } : {})}
      title={title}
      aria-label={title}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      <span className="nav-item-icon" aria-hidden>
        {children}
      </span>
      <span className="nav-item-label" aria-hidden={!expanded}>{title}</span>
      {badgeValue > 0 && (
        <span className="nav-badge-dot" aria-hidden>
          {badgeValue > 1 ? (badgeValue > 99 ? '99+' : badgeValue) : null}
        </span>
      )}
    </NavLink>
  );
}

const NAV_RAIL_STORAGE_KEY = 'zd-nav-expanded';

function formatPauseDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function usePauseDuration(startedAt: string | null): string {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setDuration(0);
      return;
    }

    const update = () => {
      const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      setDuration(Math.max(0, diff));
    };

    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return formatPauseDuration(duration);
}

/* ── TenantLayout ─────────────────────────────────────────────────────────── */
export function TenantLayout() {
  const { t } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');
  const { showNotification } = useNotification();
  const { canAny } = usePermission();
  const { user, token, isAuthenticated, logout, isLoggingOut } = useAuth();
  const setAuth = useAuthStore((state) => state.setAuth);
  const toast = useToast();
  const { pathname } = useLocation();
  const showFloatingBubble = !pathname.startsWith('/omnichannel');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const unreadConversationNotifications = useNotificationStore((state) => state.messageNotifications.length);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [impersonatedTenantName, setImpersonatedTenantName] = useState<string | null>(null);
  const [isNavExpanded, setIsNavExpanded] = useState(() => {
    try {
      return localStorage.getItem(NAV_RAIL_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const canAccessAdminData = canAny('settings:manage', 'users:manage');
  const canToggleAvailability = canAny('conversations:reply', 'conversations:manage');
  const canViewMetricsNav = canAny('metrics:view');
  const canViewQueue = canAny('conversations:reply', 'conversations:manage');
  const canViewAdminNav = canAny('settings:manage', 'users:manage');
  const isImpersonating = !!impersonatedTenantName;
  const roleLabel =
    user?.role === 'owner'
      ? 'Owner'
      : user?.role === 'admin'
        ? 'Admin'
        : user?.role === 'supervisor'
          ? t('tenantAdmin.users.roles.supervisor')
        : user?.role === 'agent'
          ? 'Agente'
          : 'Visualização';
  const isManager = ['owner', 'admin', 'supervisor'].includes(user?.role ?? '');
  const {
    status: agentStatus,
    pauseReason,
    pauseStartedAt,
    startPause,
    endPause,
    isStartingPause,
    isEndingPause,
    hasLoadedStatus,
  } = useAgentStatus(canToggleAvailability);
  const pauseDuration = usePauseDuration(pauseStartedAt);
  useFaviconBadge(unreadConversationNotifications > 0);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_RAIL_STORAGE_KEY, String(isNavExpanded));
    } catch {
      // Preferencia visual; sem impacto se o navegador bloquear storage.
    }
  }, [isNavExpanded]);

  useEffect(() => {
    const baseTitle = getCurrentZiraDeskTitle();
    document.title = unreadConversationNotifications > 0
      ? `(${unreadConversationNotifications}) ${baseTitle}`
      : baseTitle;
  }, [pathname, unreadConversationNotifications]);

  useEffect(() => {
    const tenantName = sessionStorage.getItem('impersonated_tenant_name');
    const hasSuperAdminToken = sessionStorage.getItem('superadmin_token');
    if (tenantName && hasSuperAdminToken) {
      setImpersonatedTenantName(tenantName);
      return;
    }
    setImpersonatedTenantName(null);
  }, []);

  useEffect(() => {
    if (!canToggleAvailability || !hasLoadedStatus) return;
    setPresenceStatus(agentStatus);
  }, [agentStatus, canToggleAvailability, hasLoadedStatus]);

  useEffect(() => {
    if (!canToggleAvailability || !user?.id) return;

    const refreshOwnPresence = (payload: { userId?: string } | undefined) => {
      if (!payload?.userId || payload.userId !== user.id) return;
      void queryClient.invalidateQueries({ queryKey: ['agent-status'] });
    };

    const unsubOnline = subscribeToEvent<{ userId: string }>('agent:online', refreshOwnPresence);
    const unsubOffline = subscribeToEvent<{ userId: string }>('agent:offline', refreshOwnPresence);
    const unsubPaused = subscribeToEvent<{ userId: string }>('agent:paused', refreshOwnPresence);
    const unsubResumed = subscribeToEvent<{ userId: string }>('agent:resumed', refreshOwnPresence);

    return () => {
      unsubOnline();
      unsubOffline();
      unsubPaused();
      unsubResumed();
    };
  }, [canToggleAvailability, queryClient, user?.id]);

  useQuery({
    queryKey: ['my-profile'],
    queryFn: profileApi.get,
    staleTime: 5 * 60_000,
    enabled: isAuthenticated,
  });

  const { data: settings } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
    staleTime: 5 * 60_000,
    enabled: canAccessAdminData,
  });

  const { data: convCounts } = useQuery({
    queryKey: ['conversation-counts'],
    queryFn: () => api.get('/omnichannel/conversations/counts')
      .then((r) => r.data.data as {
        open: number;
        waiting: number;
        mine: number;
        queue: number;
        active: number;
        closed: number;
        return?: number;
      }),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: isAuthenticated,
  });
  const queueCount = convCounts?.queue ?? 0;

  const { data: backendNotifications = [] } = useQuery({
    queryKey: ['notifications', 'nav-badge'],
    queryFn: () => api.get('/notifications')
      .then((r) => r.data.data as Array<{
        id: string;
        type: string;
        read: boolean;
      }>),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: isAuthenticated,
  });

  const ticketUnreadCount = backendNotifications.filter(
    (n) => !n.read && (
      n.type === 'ticket_assigned' || n.type === 'ticket_comment'
    ),
  ).length;

  const setAvailabilityMutation = useMutation({
    mutationFn: (nextAvailability: boolean) =>
      adminApi.autoAssign.setAvailability({ is_available: nextAvailability }),
    onSuccess: async () => {
      setShowStatusMenu(false);
      await queryClient.invalidateQueries({ queryKey: ['agent-status'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'auto-assign'] });
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  useEffect(() => {
    if (canToggleAvailability && !hasLoadedStatus) return undefined;
    if (token && user?.tenantId) {
      connectSocket(token, user.tenantId);
    }
    return () => { disconnectSocket(); };
  }, [token, user?.tenantId, canToggleAvailability, hasLoadedStatus]);

  useEffect(() => {
    if (!user?.id) return;

    const unsubHelpRequested = subscribeToEvent<{
      conversationId: string;
      requestedBy: { id: string; name: string };
      protocol?: string | null;
    }>('help:requested', (data) => {
      toast.helpRequest({
        message: t('help.requested', { ns: 'omnichannel', name: data.requestedBy.name }),
        protocol: data.protocol ?? null,
        agentName: data.requestedBy.name,
        onAccept: () => {
          navigate(`/omnichannel/conversations?conversation=${encodeURIComponent(data.conversationId)}`);
          void omnichannelApi.acceptHelp(data.conversationId).then(() => {
            toast.success(t('help.accept', { ns: 'omnichannel' }));
            void queryClient.invalidateQueries({ queryKey: ['conversation', data.conversationId, 'helpers'] });
            void queryClient.invalidateQueries({ queryKey: ['conversation', data.conversationId] });
            void queryClient.invalidateQueries({ queryKey: ['conversations'] });
            void queryClient.invalidateQueries({ queryKey: ['monitor'] });
          }).catch(() => {
            toast.error('Erro ao aceitar ajuda');
          });
        },
        onDecline: () => {
          void omnichannelApi.declineHelp(data.conversationId).then(() => {
            toast.info(t('help.decline', { ns: 'omnichannel' }));
          }).catch(() => {
            toast.error('Erro ao recusar ajuda');
          });
        },
      });
      notifySound('help');
    });

    return () => {
      unsubHelpRequested();
    };
  }, [navigate, queryClient, t, toast, user?.id]);

  useEffect(() => {
    if (!isManager) return;

    const unsubRequeueAlert = subscribeToEvent<{
      agentName?: string;
      conversationCount?: number;
      message?: string;
    }>('agent:requeued:alert', (data) => {
      const fallbackMessage = t('agentRequeued', {
        ns: 'omnichannel',
        agentName: data.agentName ?? 'Agente',
        count: data.conversationCount ?? 0,
      });

      toast.warning(data.message ?? fallbackMessage, {
        durationMs: 8000,
        icon: '⚠️',
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });
    });

    return () => {
      unsubRequeueAlert();
    };
  }, [isManager, queryClient, t, toast]);

  useEffect(() => {
    const unsubActiveOutboundReplied = subscribeToEvent<{
      conversationId: string;
      contactName: string;
    }>('active_outbound:replied', (data) => {
      toast.success(
        t('activeOutbound.replied', { ns: 'omnichannel', name: data.contactName }),
        { durationMs: 6000, icon: '💬' },
      );
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation', data.conversationId] });
    });

    return () => {
      unsubActiveOutboundReplied();
    };
  }, [queryClient, t, toast]);

  useEffect(() => {
    if (!['owner', 'admin', 'supervisor'].includes(user?.role ?? '')) return;

    const unsubCreated = subscribeToEvent<{
      assigned_to?: string | null;
      assignedTo?: string | null;
      assignedAgentId?: string | null;
      conversation?: {
        assigned_to?: string | null;
        assignedTo?: string | null;
        assignedAgentId?: string | null;
      };
    }>('conversation:created', (data) => {
      const assignedTo =
        data.assigned_to
        ?? data.assignedTo
        ?? data.assignedAgentId
        ?? data.conversation?.assigned_to
        ?? data.conversation?.assignedTo
        ?? data.conversation?.assignedAgentId
        ?? null;

      if (!assignedTo) {
        notifySound('message');
      }
    });

    return () => {
      unsubCreated();
    };
  }, [user?.role]);

  useEffect(() => {
    if (!user?.id || pathname.startsWith('/omnichannel')) return;

    interface SocketContactPayload {
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
      contact_name?: string | null;
      contactName?: string | null;
      status?: string | null;
      metadata?: Record<string, unknown> | null;
      assigned_to?: string | null;
      assignedTo?: string | null;
      assignedAgentId?: string | null;
    }

    interface ConversationMessageEventPayload {
      conversationId?: string;
      message?: SocketMessagePayload;
      conversation?: SocketConversationPayload;
      contact?: SocketContactPayload;
      contactName?: string | null;
    }

    interface ConversationUpdatedEventPayload {
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
    }

    const handleIncomingMessage = (data: ConversationMessageEventPayload) => {
      const senderType = data.message?.sender_type ?? data.message?.senderType ?? null;
      if (senderType !== 'client') return;

      if (isConversationBotControlled(data.conversation)) return;

      const currentUserId = user?.id ?? null;
      const assignedTo =
        data.conversation?.assigned_to
        ?? data.conversation?.assignedTo
        ?? data.conversation?.assignedAgentId
        ?? null;
      if (!currentUserId || assignedTo !== currentUserId) return;

      const conversationId = data.conversationId;
      if (!conversationId) return;

      const contactName =
        data.contact?.name
        ?? data.contactName
        ?? data.conversation?.contact_name
        ?? data.conversation?.contactName
        ?? t('floatingBubble.newConversation', { ns: 'common' });

      const messageText = data.message?.content?.trim() || t('notifications.newMessage', { ns: 'omnichannel' });

      useNotificationStore.getState().addMessage({
        conversationId,
        contactName,
        message: messageText,
        timestamp: new Date().toISOString(),
      });
    };

    const handleConversationUpdated = (data: ConversationUpdatedEventPayload) => {
      const currentUserId = user?.id ?? null;
      const conversationId = data.conversationId ?? data.conversation?.id;
      if (!conversationId) return;

      const assignedTo =
        data.assigned_to
        ?? data.assignedTo
        ?? data.assignedAgentId
        ?? data.conversation?.assigned_to
        ?? data.conversation?.assignedTo
        ?? data.conversation?.assignedAgentId
        ?? null;

      if (assignedTo !== currentUserId) {
        useNotificationStore.getState().markConversationRead(conversationId);
      }
    };

    const handleAssigned = (_data: { conversationId?: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });

      const hidden = typeof document !== 'undefined' && document.hidden === true;
      if (hidden) {
        if (shouldShowDesktopNotification()) {
          showNotification(
            t('notifications.assigned', { ns: 'omnichannel' }),
            t('notifications.assignedBody', { ns: 'omnichannel' }),
            '/icon-192.png',
          );
        }
      } else {
        notifySound('assignment');
      }
    };

    const unsubA = subscribeToEvent<ConversationMessageEventPayload>('conversation:new_message', handleIncomingMessage);
    const unsubB = subscribeToEvent<ConversationMessageEventPayload>('conversation:message', handleIncomingMessage);
    const unsubUpdated = subscribeToEvent<ConversationUpdatedEventPayload>('conversation:updated', handleConversationUpdated);
    const unsubAssigned = subscribeToEvent<{ conversationId?: string }>('conversation:assigned', handleAssigned);

    return () => {
      unsubA();
      unsubB();
      unsubUpdated();
      unsubAssigned();
    };
  }, [pathname, queryClient, showNotification, t, user?.id, user?.role]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(event.target as Node)) {
        setShowStatusMenu(false);
      }

      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };

    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  const initial = user?.name.charAt(0).toUpperCase() ?? '?';
  const avatarUrl = user?.avatar_url ?? null;
  const isStatusBusy = setAvailabilityMutation.isPending || isStartingPause || isEndingPause;
  const statusLabel =
    agentStatus === 'paused'
      ? `${t('tenantAdmin.pause.status.paused')} - ${pauseReason ?? t('tenantAdmin.pause.reasons.other')}${pauseStartedAt ? ` - ${pauseDuration}` : ''}`
      : agentStatus === 'offline'
        ? t('tenantAdmin.pause.status.offline')
        : t('tenantAdmin.pause.status.online');

  const handleResumeOnline = async () => {
    try {
      if (agentStatus === 'paused') {
        await endPause();
      } else {
        await setAvailabilityMutation.mutateAsync(true);
      }
      setPresenceStatus('online');
      setShowStatusMenu(false);
    } catch {
      toast.error(t('tenantAdmin.common.errorSave'));
    }
  };

  const handleStartPause = async (payload: { reason: string; notes?: string }) => {
    try {
      await startPause(payload);
      setPresenceStatus('paused');
      setShowPauseModal(false);
      toast.success(t('tenantAdmin.pause.messages.started'));
    } catch {
      toast.error(t('tenantAdmin.common.errorSave'));
    }
  };

  const handleLogout = () => {
    setShowProfileMenu(false);
    logout();
  };

  const handleBackToSuperAdmin = () => {
    const superAdminToken = sessionStorage.getItem('superadmin_token');
    const superAdminUserRaw = sessionStorage.getItem('superadmin_user');
    if (!superAdminToken || !superAdminUserRaw) {
      logout();
      return;
    }

    try {
      const parsedUser = JSON.parse(superAdminUserRaw) as AuthUser;
      setAuth({ user: parsedUser, token: superAdminToken });
      sessionStorage.removeItem('superadmin_token');
      sessionStorage.removeItem('superadmin_user');
      sessionStorage.removeItem('impersonated_tenant_slug');
      sessionStorage.removeItem('impersonated_tenant_name');
      setImpersonatedTenantName(null);
      navigate('/super-admin', { replace: true });
    } catch {
      logout();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', color: 'var(--txt)', paddingTop: isImpersonating ? 36 : 0 }}>
      {isImpersonating && (
        <div className="impersonation-banner">
          <span>{t('superAdmin.tenants.impersonateBanner', { tenant: impersonatedTenantName })}</span>
          <button type="button" onClick={handleBackToSuperAdmin}>
            {t('superAdmin.tenants.backToSuperAdmin')}
          </button>
        </div>
      )}

      {/* ── Topbar ── */}
      <header style={{
        height: 52,
        minHeight: 52,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 16px',
        background: 'var(--bg-2)',
        borderBottom: '1px solid var(--line)',
        zIndex: 10,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingRight: 16, borderRight: '1px solid var(--line)', marginRight: 6 }}>
          <BrandLogo className="brand-logo" width={132} height={30} />
        </div>

        {/* Breadcrumb */}
        <div style={{ flex: 1 }}>
          <Breadcrumb />
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canToggleAvailability ? (
            <div className="status-dropdown-wrap" ref={statusMenuRef}>
              <button
                type="button"
                className="status-dropdown"
                onClick={() => setShowStatusMenu((current) => !current)}
                title={`Perfil atual: ${roleLabel}`}
                disabled={isStatusBusy}
              >
                <span className={`status-dot ${agentStatus}`} />
                {statusLabel}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {showStatusMenu && (
                <div className="status-menu">
                  {agentStatus !== 'online' && (
                    <button type="button" onClick={() => void handleResumeOnline()} disabled={isStatusBusy}>
                      <span className="dot online" />
                      {t('tenantAdmin.pause.end')}
                    </button>
                  )}
                  {agentStatus === 'online' && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowStatusMenu(false);
                        setShowPauseModal(true);
                      }}
                      disabled={isStatusBusy}
                    >
                      <span className="dot paused" />
                      {t('tenantAdmin.pause.start')}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="topbar-chip" title={`Perfil atual: ${roleLabel}`}>
              <span className="topbar-chip-dot" aria-hidden />
              {roleLabel}
            </div>
          )}

          <ThemeToggle />

          <LanguageSelector />

          <button
            className="topbar-search-btn"
            onClick={() => setSearchOpen(true)}
            aria-label="Abrir busca global"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Buscar...</span>
            <span className="topbar-search-shortcut">Ctrl K</span>
          </button>

          <NotificationCenter />

          {/* Conversations-specific topbar actions */}
          {pathname === '/omnichannel/conversations' && (
            <PermissionGate permission="conversations:reply">
              <>
                <button
                  className="topbar-primary-btn"
                  onClick={() => window.dispatchEvent(new CustomEvent('omnichannel:open-modal'))}
                  title={t('new', { ns: 'omnichannel' })}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  {t('new', { ns: 'omnichannel' })}
                </button>
                <button
                  className="topbar-primary-btn"
                  style={{ background: 'var(--bg-3)', borderColor: 'var(--line-2)', color: 'var(--teal)', boxShadow: 'none' }}
                  onClick={() => window.dispatchEvent(new CustomEvent('omnichannel:open-active-outbound-modal'))}
                  title={t('activeOutbound.button', { ns: 'omnichannel' })}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2 10L10 2M10 2H6M10 2V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t('activeOutbound.button', { ns: 'omnichannel' })}
                </button>
                <div className="topbar-inline-divider" aria-hidden />
              </>
            </PermissionGate>
          )}

          <div className="profile-menu-wrapper" ref={profileMenuRef}>
            <button
              className="topbar-avatar-btn"
              onClick={() => setShowProfileMenu((current) => !current)}
              title={user?.name}
              aria-label="Abrir menu de perfil"
              disabled={isLoggingOut}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={user?.name ?? 'Avatar'} className="topbar-avatar-img" />
              ) : (
                <span className="topbar-avatar-initial">{initial}</span>
              )}
            </button>

            {showProfileMenu && (
              <div className="profile-dropdown">
                <div className="profile-dropdown-header">
                  <div className="profile-dropdown-avatar">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={user?.name ?? 'Avatar'} />
                    ) : (
                      <span>{initial}</span>
                    )}
                  </div>
                  <div className="profile-dropdown-info">
                    <span className="profile-dropdown-name">{user?.name}</span>
                    <span className="profile-dropdown-email">{user?.email}</span>
                    <span className="profile-dropdown-role">{roleLabel}</span>
                  </div>
                </div>

                <div className="profile-dropdown-divider" />

                <button
                  className="profile-dropdown-item"
                  onClick={() => {
                    setShowProfileMenu(false);
                    navigate('/profile');
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                    <path
                      d="M1.5 13c0-3 2.5-5 5.5-5s5.5 2 5.5 5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                  Meu perfil
                </button>

                <button
                  className="profile-dropdown-item"
                  onClick={() => {
                    setShowProfileMenu(false);
                    navigate('/profile?tab=password');
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <rect x="2" y="6" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                    <path
                      d="M4.5 6V4.5a2.5 2.5 0 015 0V6"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <circle cx="7" cy="9.5" r="1" fill="currentColor" />
                  </svg>
                  Alterar senha
                </button>

                <button
                  className="profile-dropdown-item"
                  onClick={() => {
                    setShowProfileMenu(false);
                    navigate('/profile?tab=notifications');
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path
                      d="M7 1.5A4.5 4.5 0 002.5 6v3l-1 1.5h11L11.5 9V6A4.5 4.5 0 007 1.5z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M5.5 10.5c0 .8.7 1.5 1.5 1.5s1.5-.7 1.5-1.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    />
                  </svg>
                  Notificações
                </button>

                <div className="profile-dropdown-divider" />

                <button className="profile-dropdown-item danger" onClick={handleLogout}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path
                      d="M5 12H2.5A1.5 1.5 0 011 10.5v-7A1.5 1.5 0 012.5 2H5M9.5 10l3-3-3-3M12.5 7H5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {isLoggingOut ? 'Saindo...' : 'Sair'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Body: nav-rail + content ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Nav rail */}
        <nav
          aria-label="Navegação principal"
          className={`nav-rail${isNavExpanded ? ' is-expanded' : ''}`}
        >
          <button
            type="button"
            className="nav-rail-toggle"
            aria-label={isNavExpanded ? 'Recolher menu' : 'Expandir menu'}
            aria-expanded={isNavExpanded}
            title={isNavExpanded ? 'Recolher menu' : 'Expandir menu'}
            onClick={() => setIsNavExpanded((current) => !current)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M4 5h10M4 9h10M4 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>Menu</span>
          </button>

          {/* Início */}
          {isManager && (
            <NavItem to="/home" title={tCommon('home.navLabel')} expanded={isNavExpanded}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M3 8.2 9 3l6 5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 7.5V15h3.2v-4.2h1.6V15H13V7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </NavItem>
          )}
          {!isManager && user?.role === 'agent' && (
            <NavItem to="/agent-home" title={tCommon('home.navLabel')} expanded={isNavExpanded}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M3 8.2 9 3l6 5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 7.5V15h3.2v-4.2h1.6V15H13V7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </NavItem>
          )}

          {/* Atendimentos */}
          <NavItem
            to="/omnichannel/conversations"
            title={t('nav.conversations')}
            badge={unreadConversationNotifications}
            expanded={isNavExpanded}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path
                d="M4 4.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-3.5 2v-2H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path d="M6 7.5h6M6 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </NavItem>

          {/* Monitor + Fila */}
          {(isManager || canViewQueue) && (
            <NavItem
              to="/monitor-hub"
              title={t('nav.monitor')}
              expanded={isNavExpanded}
              {...(canViewQueue ? { badge: queueCount } : {})}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M3 13.5V4.5h12v9H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M6 11l2.3-2.8 2 1.7L12 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </NavItem>
          )}

          {/* Análise (Métricas + Histórico + Performance) */}
          {canViewMetricsNav && (
            <NavItem to="/omnichannel/analyse" title={t('nav.analysis')} expanded={isNavExpanded}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M3 14.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <rect x="4" y="8.5" width="2.5" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
                <rect x="7.75" y="6.5" width="2.5" height="6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
                <rect x="11.5" y="4" width="2.5" height="8.5" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </NavItem>
          )}

          {/* CRM (Contatos + Organizações) */}
          <NavItem to="/crm" title={t('nav.crm')} expanded={isNavExpanded}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="9" cy="6.5" r="2.8" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M3 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </NavItem>

          {/* Tickets */}
          <NavItem to="/tickets" title={t('nav.tickets')} badge={ticketUnreadCount} expanded={isNavExpanded}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path
                d="M4 5h10a1.5 1.5 0 0 1 1.5 1.5v1.2a1.2 1.2 0 0 0-1 1.18 1.2 1.2 0 0 0 1 1.18v1.42A1.5 1.5 0 0 1 14 14H4a1.5 1.5 0 0 1-1.5-1.5v-1.42a1.2 1.2 0 0 0 1-1.18 1.2 1.2 0 0 0-1-1.18V6.5A1.5 1.5 0 0 1 4 5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path d="M7 7.5h4M7 10.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </NavItem>

          {/* Campanhas */}
          <NavItem to="/omnichannel/campaigns" title={t('nav.campaigns')} expanded={isNavExpanded}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M3 10.2H2.5A1.5 1.5 0 0 1 1 8.7V7.3a1.5 1.5 0 0 1 1.5-1.5H5l7-3v10.4l-7-3H3Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 10.2 6.2 15H4.1L3 10.2M14.2 6.2c.7.4 1.1 1 1.1 1.8s-.4 1.4-1.1 1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </NavItem>

          <div className="nav-divider" />

          {/* Administração */}
          {canViewAdminNav && (
            <NavItem to="/admin" title={t('nav.admin')} expanded={isNavExpanded}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <rect x="3" y="3" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="9" cy="9" r="2.3" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M9 5.2v1.1M9 11.7v1.1M5.2 9h1.1M11.7 9h1.1M6.3 6.3l.8.8M10.9 10.9l.8.8M6.3 11.7l.8-.8M10.9 7.1l.8-.8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </NavItem>
          )}

          {/* Spacer + bottom avatar */}
          <div style={{ flex: 1 }} />
          <div
            title={user?.email}
            className="nav-user"
          >
            <span className="nav-user-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={user?.name ?? 'Avatar'} />
              ) : (
                initial
              )}
            </span>
            <span className="nav-user-copy">
              <strong>{user?.name ?? 'Usuário'}</strong>
              <span>{user?.email}</span>
            </span>
          </div>

          <NavLink
            to="/settings/upgrade"
            title={`Plano atual: ${settings?.plan?.name ?? '—'}`}
            className={({ isActive }) => `nav-plan${isActive ? ' active' : ''}`}
          >
            <span>Plano atual</span>
            <strong>{settings?.plan?.name ?? '—'}</strong>
          </NavLink>
        </nav>

        {/* Content area */}
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <Outlet />
          </div>
          <footer className="app-legal-footer">
            <span>Powered by ZiraDesk</span>
            <span className="app-legal-footer-separator" aria-hidden>•</span>
            <Link to="/politica-de-privacidade" className="legal-footer-link">Política de Privacidade</Link>
            <span className="app-legal-footer-separator" aria-hidden>•</span>
            <Link to="/termos-de-uso" className="legal-footer-link">Termos de Uso</Link>
            <LegalDpoLink prefix={<span className="app-legal-footer-separator" aria-hidden>•</span>} />
          </footer>
        </main>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <PauseModal
        open={showPauseModal}
        onClose={() => setShowPauseModal(false)}
        onConfirm={handleStartPause}
        isSubmitting={isStartingPause}
      />
      <FloatingChatBubble visible={showFloatingBubble} />
      {canAccessAdminData ? <OnboardingChecklist /> : null}
    </div>
  );
}
