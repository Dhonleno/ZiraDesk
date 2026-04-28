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

  const isCRM     = pathname.startsWith('/crm');
  const isConversations = pathname.startsWith('/omnichannel');
  const isAdmin   = pathname.startsWith('/admin');
  const isTickets = pathname.startsWith('/tickets');

  const routeLabels: Record<string, string> = {
    '/crm/clients':      'Clientes',
    '/tickets':          'Tickets',
    '/admin/dashboard':  t('tenantAdmin.nav.dashboard'),
    '/admin/users':      t('tenantAdmin.nav.users'),
    '/admin/channels':   t('tenantAdmin.nav.channels'),
    '/admin/settings':   t('tenantAdmin.nav.settings'),
  };

  const staticLabel = isConversations ? 'Central de Atendimento' : (routeLabels[pathname] ?? (isTickets ? 'Tickets' : ''));
  const section = isAdmin ? 'Admin' : isCRM ? 'CRM' : isTickets ? 'Tickets' : 'Omnichannel';
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
  const { pathname } = useLocation();

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
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingRight: 16, borderRight: '1px solid var(--line)', marginRight: 4 }}>
          <Logo />
        </div>

        {/* Breadcrumb */}
        <div style={{ flex: 1 }}>
          <Breadcrumb />
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Online indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 'var(--r-pill)', background: 'var(--green-dim)', border: '1px solid rgba(62,207,142,.25)', fontSize: 11, fontWeight: 500, color: 'var(--green)', flexShrink: 0 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
            Online
          </div>

          <ThemeToggle />

          {/* Conversations-specific topbar actions */}
          {pathname.startsWith('/omnichannel') && (
            <>
              <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--teal)', background: 'var(--teal)', color: '#0E1A18', whiteSpace: 'nowrap', fontFamily: 'var(--font)' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Novo atendimento
              </button>
              <button className="tb-icon-btn" aria-label="Histórico">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/><path d="M7 4v3.5l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </button>
              <button className="tb-icon-btn" aria-label="Empresa">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 11V4.5l5-3 5 3V11H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M5 11V7.5h4V11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
              </button>
              <div style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 2px' }} />
            </>
          )}

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
          <NavItem to="/omnichannel/conversations" title="Atendimentos">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M3 13V5.5l6-4 6 4V13H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M3 8h12" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </NavItem>

          {/* Clientes */}
          <NavItem to="/crm/clients" title="Clientes">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2 16c0-3.5 3-6 7-6s7 2.5 7 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </NavItem>

          {/* Tickets */}
          <NavItem to="/tickets" title="Tickets">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <rect x="2.5" y="3" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.5 7h7M5.5 10h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </NavItem>

          {/* Campanhas (placeholder) */}
          <div className="nav-item" title="Campanhas" style={{ opacity: 0.5, cursor: 'default' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M3 12l3-7 3 4 2-2 4 5H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Divisor */}
          <div style={{ width: 32, height: 1, background: 'var(--line)', margin: '6px 0' }} />

          {/* Relatórios (placeholder) */}
          <div className="nav-item" title="Relatórios" style={{ opacity: 0.5, cursor: 'default' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <rect x="2.5" y="2.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6 11V9M9 11V7M12 11V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </div>

          {/* Configurações */}
          <NavItem to="/admin/settings" title={t('tenantAdmin.nav.settings')}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M9 2v2M9 14v2M2 9h2M14 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M3.9 14.1l1.4-1.4M12.7 5.3l1.4-1.4"
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
