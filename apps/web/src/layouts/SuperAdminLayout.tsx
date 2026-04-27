import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

type NavItemStyle = { isActive: boolean };

const navClass = ({ isActive }: NavItemStyle) =>
  [
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
    isActive
      ? 'font-medium border-l-[3px] border-l-[#00C9A7] text-[#00C9A7]'
      : 'font-normal border-l-[3px] border-l-transparent text-[#9DA3AE] hover:bg-[#22252B] hover:text-[#F0F1F3]',
  ].join(' ');

const navStyle = ({ isActive }: NavItemStyle): React.CSSProperties =>
  isActive ? { background: 'rgba(0,201,167,.15)' } : {};

export function SuperAdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen text-[#F0F1F3]" style={{ background: '#0E0F11' }}>
      <aside
        className="flex w-60 flex-col"
        style={{ background: '#141518', borderRight: '1px solid rgba(255,255,255,.07)' }}
      >
        {/* Logo */}
        <div
          className="flex h-16 items-center gap-2 px-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-[10px]"
            style={{
              background: 'rgba(0,201,167,.15)',
              border: '1px solid rgba(0,201,167,.25)',
              color: '#00C9A7',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 56 56" fill="none" aria-hidden>
              <path
                d="M14 16 L42 16 L14 40 L42 40"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: '#F0F1F3' }}>
              <span style={{ fontWeight: 700 }}>Zira</span>
              <span style={{ fontWeight: 300 }}>Desk</span>
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-xs font-medium"
              style={{
                background: 'rgba(0,201,167,.15)',
                color: '#00C9A7',
                border: '1px solid rgba(0,201,167,.25)',
              }}
            >
              Admin
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
          <NavLink to="/super-admin" end className={navClass} style={navStyle}>
            Dashboard
          </NavLink>
          <NavLink to="/super-admin/tenants" className={navClass} style={navStyle}>
            Tenants
          </NavLink>
          <NavLink to="/super-admin/plans" className={navClass} style={navStyle}>
            Planos
          </NavLink>
        </nav>

        {/* Footer user */}
        <div
          className="p-3"
          style={{ borderTop: '1px solid rgba(255,255,255,.07)', background: '#1A1C20' }}
        >
          <div className="flex items-center gap-3 px-2 py-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: '#22252B', color: '#9DA3AE' }}
            >
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" style={{ color: '#F0F1F3' }}>
                {user?.name}
              </p>
              <p className="truncate text-xs" style={{ color: '#9DA3AE' }}>
                Super Admin
              </p>
            </div>
            <button
              onClick={() => logout()}
              className="transition-colors"
              style={{ color: '#5C6370' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#9DA3AE')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#5C6370')}
              aria-label="Sair"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path
                  d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden" style={{ background: '#0E0F11' }}>
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
