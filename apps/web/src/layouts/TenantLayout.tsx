import { useEffect, useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { adminApi, omnichannelApi } from '../services/api';
import { connectSocket, disconnectSocket, subscribeToEvent } from '../services/socket';
import { GlobalSearch } from '../components/ui/GlobalSearch';
import { NotificationCenter } from '../components/ui/NotificationCenter';
import { FloatingChatBubble } from '../components/ui/FloatingChatBubble';
import { OnboardingChecklist } from '../components/onboarding/OnboardingChecklist';
import { useAgentStatus } from '../hooks/useAgentStatus';
import { PauseModal } from '../components/omnichannel/PauseModal';
import { usePermission } from '../hooks/usePermission';
import { useToast } from '../stores/toast.store';
import { useNotificationStore } from '../stores/notification.store';

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

/* ── Logo SVG ─────────────────────────────────────────────────────────────── */
function Logo() {
  return (
    <svg width="120" height="28" viewBox="0 0 160 36" style={{ display: 'block' }} aria-label="ZiraDesk">
      <rect x="0" y="0" width="36" height="36" rx="8" className="brand-logo-bg" />
      <rect x="0" y="0" width="36" height="36" rx="8" fill="none" className="brand-logo-stroke" strokeWidth="1" />
      <path
        d="M9 10 L27 10 L9 26 L27 26"
        fill="none"
        className="brand-logo-z"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="46" y="23" fontFamily="'IBM Plex Sans',system-ui" fontSize="16" fontWeight="700" className="brand-logo-zira" letterSpacing="-0.3">
        Zira
      </text>
      <text x="82" y="23" fontFamily="'IBM Plex Sans',system-ui" fontSize="16" fontWeight="300" className="brand-logo-desk" letterSpacing="-0.3">
        Desk
      </text>
    </svg>
  );
}

/* ── Breadcrumb ───────────────────────────────────────────────────────────── */
function Breadcrumb() {
  const { t } = useTranslation('admin');
  const { pathname } = useLocation();

  const isCRM     = pathname.startsWith('/crm');
  const isConversations = pathname.startsWith('/omnichannel');
  const isAdmin   = pathname.startsWith('/admin');
  const isTickets = pathname.startsWith('/tickets');
  const isProfile = pathname.startsWith('/profile');

  const routeLabels: Record<string, string> = {
    '/omnichannel/monitor': 'Monitor',
    '/omnichannel/metrics': 'Métricas',
    '/crm/organizations': 'Organizações',
    '/crm/contacts':      'Contatos',
    '/tickets':           'Tickets',
    '/profile':           'Meu perfil',
    '/admin/users':       t('tenantAdmin.nav.users'),
    '/admin/roles':       t('roles.title'),
    '/admin/channels':    t('tenantAdmin.nav.channels'),
    '/admin/business-hours': t('tenantAdmin.nav.businessHours'),
    '/admin/bot': t('tenantAdmin.nav.bot'),
    '/admin/auto-assign': t('tenantAdmin.nav.autoAssign'),
    '/admin/pause-reasons': t('tenantAdmin.nav.pauseReasons'),
    '/admin/quick-replies': t('tenantAdmin.nav.quickReplies'),
    '/admin/ticket-types': t('tenantAdmin.nav.ticketTypes'),
    '/admin/conversation-tags': t('tenantAdmin.nav.conversationTags'),
    '/admin/close-config': t('tenantAdmin.closeConfig.title'),
    '/admin/settings':    t('tenantAdmin.nav.settings'),
  };

  const staticLabel = routeLabels[pathname]
    ?? (pathname.startsWith('/omnichannel/monitor')
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
type NavItemProps = { to: string; end?: true; title: string; children: React.ReactNode };

function NavItem({ to, end, title, children }: NavItemProps) {
  return (
    <NavLink
      to={to}
      {...(end ? { end } : {})}
      title={title}
      aria-label={title}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      {children}
    </NavLink>
  );
}

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
  const { canAny } = usePermission();
  const { user, token, logout, isLoggingOut } = useAuth();
  const toast = useToast();
  const { pathname } = useLocation();
  const showFloatingBubble = !pathname.startsWith('/omnichannel');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const canAccessAdminData = canAny('settings:manage', 'users:manage');
  const canToggleAvailability = canAny('conversations:reply', 'conversations:manage');
  const canViewMetricsNav = canAny('metrics:view', 'metrics:own');
  const canViewAdminNav = canAny('settings:manage', 'users:manage');
  const roleLabel =
    user?.role === 'owner'
      ? 'Owner'
      : user?.role === 'admin'
        ? 'Admin'
        : user?.role === 'agent'
          ? 'Agente'
          : 'Visualização';
  const {
    status: agentStatus,
    pauseReason,
    pauseStartedAt,
    startPause,
    endPause,
    isStartingPause,
    isEndingPause,
  } = useAgentStatus(canToggleAvailability);
  const pauseDuration = usePauseDuration(pauseStartedAt);

  const { data: settings } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
    staleTime: 5 * 60_000,
    enabled: canAccessAdminData,
  });

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
    if (token && user?.tenantId) {
      connectSocket(token, user.tenantId);
    }
    return () => { disconnectSocket(); };
  }, [token, user?.tenantId]);

  useEffect(() => {
    if (!user?.id) return;

    const playNotificationSound = () => {
      try {
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.value = 0.06;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.12);
      } catch {
        // sem suporte de audio no navegador
      }
    };

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
      playNotificationSound();
    });

    return () => {
      unsubHelpRequested();
    };
  }, [navigate, queryClient, t, toast, user?.id]);

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
      client_name?: string | null;
      clientName?: string | null;
    }

    interface ConversationMessageEventPayload {
      conversationId?: string;
      message?: SocketMessagePayload;
      conversation?: SocketConversationPayload;
      contact?: SocketContactPayload;
      contactName?: string | null;
    }

    const handleIncomingMessage = (data: ConversationMessageEventPayload) => {
      const senderType = data.message?.sender_type ?? data.message?.senderType ?? null;
      if (senderType !== 'client') return;

      const conversationId = data.conversationId;
      if (!conversationId) return;

      const contactName =
        data.contact?.name
        ?? data.contactName
        ?? data.conversation?.contact_name
        ?? data.conversation?.contactName
        ?? data.conversation?.client_name
        ?? data.conversation?.clientName
        ?? t('floatingBubble.newConversation', { ns: 'common' });

      const messageText = data.message?.content?.trim() || t('notifications.newMessage', { ns: 'omnichannel' });

      useNotificationStore.getState().addMessage({
        conversationId,
        contactName,
        message: messageText,
        timestamp: new Date().toISOString(),
      });
    };

    const unsubA = subscribeToEvent<ConversationMessageEventPayload>('conversation:new_message', handleIncomingMessage);
    const unsubB = subscribeToEvent<ConversationMessageEventPayload>('conversation:message', handleIncomingMessage);

    return () => {
      unsubA();
      unsubB();
    };
  }, [pathname, t, user?.id]);

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
      setShowStatusMenu(false);
    } catch {
      toast.error(t('tenantAdmin.common.errorSave'));
    }
  };

  const handleStartPause = async (payload: { reason: string; notes?: string }) => {
    try {
      await startPause(payload);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', color: 'var(--txt)' }}>

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
          <Logo />
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
          {pathname.startsWith('/omnichannel') && (
            <>
              <button
                className="topbar-primary-btn"
                onClick={() => window.dispatchEvent(new CustomEvent('omnichannel:open-modal'))}
                title="Criar novo atendimento"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Novo atendimento
              </button>
              <div className="topbar-inline-divider" aria-hidden />
            </>
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
          aria-label="Main navigation"
          style={{
            width: 68,
            minWidth: 68,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 0 10px',
            gap: 6,
            background: 'var(--bg-2)',
            borderRight: '1px solid var(--line)',
            boxShadow: 'inset -1px 0 0 rgba(255,255,255,.02)',
          }}
        >
          {/* Atendimentos */}
          <NavItem to="/omnichannel/conversations" title="Atendimentos">
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

          {/* Monitor */}
          <NavItem to="/omnichannel/monitor" title="Monitor">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M3 13.5V4.5h12v9H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M6 11l2.3-2.8 2 1.7L12 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </NavItem>

          {/* Métricas */}
          {canViewMetricsNav && (
            <NavItem to="/omnichannel/metrics" title="Métricas">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M3 14.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <rect x="4" y="8.5" width="2.5" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
                <rect x="7.75" y="6.5" width="2.5" height="6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
                <rect x="11.5" y="4" width="2.5" height="8.5" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </NavItem>
          )}

          {/* Organizações */}
          <NavItem to="/crm/organizations" title="Organizações">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <rect x="2" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              <path d="M6 5V4a2 2 0 012-2h2a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M6 9h6M6 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </NavItem>

          {/* Contatos */}
          <NavItem to="/crm/contacts" title="Contatos">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="9" cy="6.5" r="2.8" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M3 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </NavItem>

          {/* Tickets */}
          <NavItem to="/tickets" title="Tickets">
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

          <div style={{ width: 28, height: 1, background: 'var(--line)', margin: '10px 0 6px', opacity: 0.8 }} />

          {/* Administração */}
          {canViewAdminNav && (
            <NavItem to="/admin" title="Administração">
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
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--bg-4)',
              border: '2px solid var(--bg-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--txt-2)',
              marginBottom: 6,
              overflow: 'hidden',
            }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={user?.name ?? 'Avatar'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              initial
            )}
          </div>

          <NavLink
            to="/settings/upgrade"
            title={`Plano atual: ${settings?.plan?.name ?? '—'}`}
            style={({ isActive }) => ({
              width: 58,
              display: 'block',
              textAlign: 'center',
              textDecoration: 'none',
              borderRadius: 12,
              border: `1px solid ${isActive ? 'rgba(0,201,167,.35)' : 'var(--line-2)'}`,
              background: isActive ? 'var(--teal-dim)' : 'var(--bg-3)',
              color: isActive ? 'var(--teal)' : 'var(--txt-2)',
              padding: '7px 4px',
              marginBottom: 8,
              boxShadow: isActive ? '0 8px 22px rgba(0, 201, 167, 0.12)' : 'none',
              transition: 'all .16s ease',
            })}
          >
            <span style={{ display: 'block', fontSize: 9, lineHeight: 1.1, color: 'var(--txt-3)' }}>Plano atual</span>
            <strong style={{ display: 'block', fontSize: 10, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings?.plan?.name ?? '—'}</strong>
          </NavLink>
        </nav>

        {/* Content area */}
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Outlet />
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
