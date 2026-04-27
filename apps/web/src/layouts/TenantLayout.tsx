import { useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { connectSocket, disconnectSocket } from '../services/socket';

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

export function TenantLayout() {
  const { user, token, logout, isLoggingOut } = useAuth();

  useEffect(() => {
    if (token && user?.tenantId) {
      connectSocket(token, user.tenantId);
    }
    return () => {
      disconnectSocket();
    };
  }, [token, user?.tenantId]);

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
          <span style={{ color: '#F0F1F3' }}>
            <span style={{ fontWeight: 700 }}>Zira</span>
            <span style={{ fontWeight: 300 }}>Desk</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
          {/* Conversas */}
          <NavLink to="/conversations" className={navClass} style={navStyle}>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden>
              <path
                d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Conversas
          </NavLink>

          {/* Separador visual antes do admin */}
          <div
            className="mx-3 my-3"
            style={{ borderTop: '1px solid rgba(255,255,255,.07)' }}
          />

          <NavLink to="/admin/dashboard" className={navClass} style={navStyle}>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Dashboard
          </NavLink>

          <NavLink to="/admin/users" className={navClass} style={navStyle}>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden>
              <path
                d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="9" cy="7" r="4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Usuários
          </NavLink>

          <NavLink to="/admin/channels" className={navClass} style={navStyle}>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden>
              <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="5" cy="19" r="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="19" cy="19" r="2" stroke="currentColor" strokeWidth="2" />
              <path d="M12 7v4M10 15l-3 2M14 15l3 2M10 11H7M14 11h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Canais
          </NavLink>

          <div
            className="mx-3 my-3"
            style={{ borderTop: '1px solid rgba(255,255,255,.07)' }}
          />

          <NavLink to="/admin/settings" className={navClass} style={navStyle}>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden>
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              <path
                d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Configurações
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
                {user?.email}
              </p>
            </div>
            <button
              onClick={() => logout()}
              disabled={isLoggingOut}
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

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden" style={{ background: '#0E0F11' }}>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
