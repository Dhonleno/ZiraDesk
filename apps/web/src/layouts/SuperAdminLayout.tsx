import { useCallback, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { BrandLogo } from '../components/layout/BrandLogo';

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
      <svg className="icon-sun" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
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

/* ── Breadcrumb ───────────────────────────────────────────────────────────── */
const ROUTE_LABELS: Record<string, string> = {
  '/super-admin': 'Dashboard',
  '/super-admin/tenants': 'Tenants',
  '/super-admin/plans': 'Planos',
};

function Breadcrumb() {
  const { pathname } = useLocation();
  const label = ROUTE_LABELS[pathname] ?? '';
  if (!label) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--txt-3)', fontSize: 12 }}>
      <span>Super Admin</span>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ color: 'var(--txt)', fontWeight: 500 }}>{label}</span>
    </div>
  );
}

/* ── Nav item ─────────────────────────────────────────────────────────────── */
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

/* ── SuperAdminLayout ─────────────────────────────────────────────────────── */
export function SuperAdminLayout() {
  const { user, logout } = useAuth();
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
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingRight: 16, borderRight: '1px solid var(--line)', marginRight: 6 }}>
          <BrandLogo className="brand-logo" width={132} height={30} />
        </div>

        <div style={{ flex: 1 }}>
          <Breadcrumb />
        </div>

        {/* Super Admin badge */}
        <span className="topbar-chip" title="Área global da plataforma">
          <span className="topbar-chip-dot" aria-hidden />
          Super Admin
        </span>

        <ThemeToggle />

        {/* Avatar */}
        <div
          title={user?.name}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--teal), #00A88C)',
            border: '2px solid var(--bg-5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--on-teal)',
            cursor: 'default',
          }}
        >
          {initial}
        </div>

        <button onClick={() => logout()} className="tb-icon-btn" aria-label="Sair">
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
      </header>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Nav rail */}
        <nav
          aria-label="Navegação Super Admin"
          style={{
            width: 72,
            minWidth: 72,
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
          {/* Dashboard */}
          <NavItem to="/super-admin" end title="Dashboard">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </NavItem>

          {/* Tenants */}
          <NavItem to="/super-admin/tenants" title="Tenants">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M9 22V12h6v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </NavItem>

          {/* Planos */}
          <NavItem to="/super-admin/plans" title="Planos">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </NavItem>

          <div style={{ width: 28, height: 1, background: 'var(--line)', margin: '10px 0 6px', opacity: 0.8 }} />

          <div style={{ flex: 1 }} />

          {/* Bottom avatar */}
          <div
            title={user?.email}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--teal), #00A88C)',
              border: '2px solid var(--bg-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--on-teal)',
              marginBottom: 6,
            }}
          >
            {initial}
          </div>
        </nav>

        {/* Content */}
        <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
