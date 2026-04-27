import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function SuperAdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <aside className="flex w-60 flex-col border-r border-yellow-900/40 bg-gray-900">
        <div className="flex h-16 items-center gap-2 border-b border-yellow-900/40 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-600">
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
          <div>
            <span className="font-bold text-white">ZiraDesk</span>
            <span className="ml-2 rounded bg-yellow-700 px-1.5 py-0.5 text-xs font-medium text-yellow-100">
              Admin
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-yellow-700/20 text-yellow-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
              ].join(' ')
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/admin/tenants"
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-yellow-700/20 text-yellow-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
              ].join(' ')
            }
          >
            Tenants
          </NavLink>
          <NavLink
            to="/admin/plans"
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-yellow-700/20 text-yellow-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
              ].join(' ')
            }
          >
            Planos
          </NavLink>
        </nav>

        <div className="border-t border-yellow-900/40 p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-800 text-xs font-bold text-yellow-200">
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user?.name}</p>
              <p className="truncate text-xs text-yellow-600">Super Admin</p>
            </div>
            <button
              onClick={() => logout()}
              className="text-gray-500 hover:text-gray-300 transition-colors"
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

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
