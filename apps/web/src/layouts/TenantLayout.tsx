import { useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { connectSocket, disconnectSocket } from '../services/socket';

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

  const routeLabels: Record<string, string> = {
    '/conversations': t('tenantAdmin.nav.conversations'),
    '/clientes': 'Clientes',
    '/admin/dashboard': t('tenantAdmin.nav.dashboard'),
    '/admin/users': t('tenantAdmin.nav.users'),
    '/admin/channels': t('tenantAdmin.nav.channels'),
    '/admin/settings': t('tenantAdmin.nav.settings'),
  };

  const label = routeLabels[pathname] ?? '';
  const section = pathname.startsWith('/admin') ? 'Admin' : t('tenantAdmin.nav.conversations');
  if (!label) return null;
  return (
    <div className="flex items-center gap-1.5" style={{ color: 'var(--txt-3)', fontSize: 12 }}>
      <span>{section}</span>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ color: 'var(--txt)', fontWeight: 500 }}>{label}</span>
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
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      {children}
    </NavLink>
  );
}

/* ── TenantLayout ─────────────────────────────────────────────────────────── */
export function TenantLayout() {
  const { t } = useTranslation('admin');
  const { user, token, logout, isLoggingOut } = useAuth();

  useEffect(() => {
    if (token && user?.tenantId) {
      connectSocket(token, user.tenantId);
    }
    return () => { disconnectSocket(); };
  }, [token, user?.tenantId]);

  const initial = user?.name.charAt(0).toUpperCase() ?? '?';

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
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <Logo />
        </div>

        {/* Breadcrumb */}
        <div style={{ flex: 1 }}>
          <Breadcrumb />
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ThemeToggle />

          {/* Avatar */}
          <div
            title={user?.name}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--purple), #8B5CF6)',
              border: '2px solid var(--bg-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: '#fff',
              cursor: 'default',
            }}
          >
            {initial}
          </div>

          {/* Logout */}
          <button
            onClick={() => logout()}
            disabled={isLoggingOut}
            className="tb-icon-btn"
            aria-label="Sair"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
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
            padding: '10px 0',
            gap: 4,
            background: 'var(--bg-2)',
            borderRight: '1px solid var(--line)',
          }}
        >
          {/* Atendimentos */}
          <NavItem to="/conversations" title={t('tenantAdmin.nav.conversations')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </NavItem>

          {/* Clientes */}
          <NavItem to="/clientes" title="Clientes">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </NavItem>

          {/* Divisor */}
          <div style={{ width: 32, height: 1, background: 'var(--line)', margin: '4px 0' }} />

          {/* Dashboard */}
          <NavItem to="/admin/dashboard" title={t('tenantAdmin.nav.dashboard')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </NavItem>

          {/* Usuários */}
          <NavItem to="/admin/users" title={t('tenantAdmin.nav.users')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path
                d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </NavItem>

          {/* Canais */}
          <NavItem to="/admin/channels" title={t('tenantAdmin.nav.channels')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="5" cy="19" r="2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="19" cy="19" r="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M12 7v4M10 15l-3 2M14 15l3 2M10 11H7M14 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </NavItem>

          {/* Divisor */}
          <div style={{ width: 32, height: 1, background: 'var(--line)', margin: '4px 0' }} />

          {/* Configurações */}
          <NavItem to="/admin/settings" title={t('tenantAdmin.nav.settings')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </NavItem>

          {/* Spacer + bottom avatar */}
          <div style={{ flex: 1 }} />
          <div
            title={user?.email}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--purple), #8B5CF6)',
              border: '2px solid var(--bg-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: '#fff',
              marginBottom: 6,
            }}
          >
            {initial}
          </div>
        </nav>

        {/* Content area */}
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
