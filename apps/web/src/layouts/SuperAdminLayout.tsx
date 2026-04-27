import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

type NavItemStyle = { isActive: boolean };

const navClass = ({ isActive }: NavItemStyle) =>
  [
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-teal-dim text-teal border-l-2 border-l-teal'
      : 'text-txt-2 hover:bg-bg-4 hover:text-txt border-l-2 border-l-transparent',
  ].join(' ');

export function SuperAdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-bg text-txt">
      <aside className="flex w-60 flex-col border-r border-line bg-bg-2">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-line px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-dim">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-teal" aria-hidden>
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="currentColor"
                strokeWidth="2"
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
          <NavLink to="/super-admin" end className={navClass}>
            Dashboard
          </NavLink>
          <NavLink to="/super-admin/tenants" className={navClass}>
            Tenants
          </NavLink>
          <NavLink to="/super-admin/plans" className={navClass}>
            Planos
          </NavLink>
        </nav>

        {/* Footer user */}
        <div className="border-t border-line bg-bg-3 p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-4 text-xs font-bold text-txt-2">
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-txt">{user?.name}</p>
              <p className="truncate text-xs text-txt-2">Super Admin</p>
            </div>
            <button
              onClick={() => logout()}
              className="text-txt-3 hover:text-txt-2 transition-colors"
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

      <main className="flex flex-1 flex-col overflow-hidden bg-bg">
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
