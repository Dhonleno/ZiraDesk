import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function TenantLayout() {
  const { user, logout, isLoggingOut } = useAuth();

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-gray-800 bg-gray-900">
        <div className="flex h-16 items-center gap-2 border-b border-gray-800 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white" aria-hidden>
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="font-bold text-white">ZiraDesk</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-600/20 text-brand-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
              ].join(' ')
            }
          >
            Dashboard
          </NavLink>
        </nav>

        <div className="border-t border-gray-800 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-800 text-xs font-bold text-brand-200">
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user?.name}</p>
              <p className="truncate text-xs text-gray-500">{user?.email}</p>
            </div>
            <button
              onClick={() => logout()}
              disabled={isLoggingOut}
              className="text-gray-500 hover:text-gray-300 transition-colors"
              title="Sair"
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

      {/* Conteúdo principal */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
