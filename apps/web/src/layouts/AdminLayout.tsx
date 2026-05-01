import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

type AdminNavItemProps = { to: string; end?: true; children: React.ReactNode; label: string };

function AdminNavItem({ to, end, children, label }: AdminNavItemProps) {
  return (
    <NavLink
      to={to}
      {...(end ? { end } : {})}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 12px',
        borderRadius: 'var(--r)',
        fontSize: 13,
        fontWeight: 500,
        textDecoration: 'none',
        color: isActive ? 'var(--teal)' : 'var(--txt-2)',
        background: isActive ? 'var(--teal-dim)' : 'transparent',
        transition: 'background 0.12s, color 0.12s',
      })}
    >
      {children}
      {label}
    </NavLink>
  );
}

export function AdminLayout() {
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const canManageUsers = user?.role === 'owner' || user?.role === 'admin';

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Admin sidebar */}
      <aside style={{
        width: 200,
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 10px',
        gap: 2,
        background: 'var(--bg-2)',
        borderRight: '1px solid var(--line)',
        overflowY: 'auto',
      }}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', padding: '0 12px 8px' }}>
          Administração
        </p>

        <AdminNavItem to="/admin/dashboard" label={t('tenantAdmin.nav.dashboard')}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <rect x="1.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <rect x="8.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <rect x="1.5" y="8.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <rect x="8.5" y="8.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </AdminNavItem>

        {canManageUsers && (
          <AdminNavItem to="/admin/users" label={t('tenantAdmin.nav.users')}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <circle cx="7.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 13c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </AdminNavItem>
        )}

        <AdminNavItem to="/admin/channels" label={t('tenantAdmin.nav.channels')}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="M2.5 11V5L7.5 2l5 3v6h-10z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M5.5 11V8.5h4V11" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </AdminNavItem>

        <AdminNavItem to="/admin/business-hours" label={t('tenantAdmin.nav.businessHours')}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7.5 4.2v3.4l2.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </AdminNavItem>

        <AdminNavItem to="/admin/bot" label={t('tenantAdmin.nav.bot')}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <rect x="2.5" y="4" width="10" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5 7h.01M10 7h.01M5.5 9.5h4M7.5 2v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </AdminNavItem>

        {canManageUsers && (
          <AdminNavItem to="/admin/auto-assign" label={t('tenantAdmin.nav.autoAssign')}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <path d="M3 11.5h9M4 9l2-2 1.5 1.5L10.5 5l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="4" cy="5" r="1.2" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="11" cy="10" r="1.2" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </AdminNavItem>
        )}

        {canManageUsers && (
          <AdminNavItem to="/admin/skills" label={t('tenantAdmin.nav.skills')}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <path d="M2 11.5h11M3.5 9l2-2 1.8 1.2 3-3 1.2 1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="3.5" cy="4.2" r="1.2" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="11.5" cy="8.8" r="1.2" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </AdminNavItem>
        )}

        {canManageUsers && (
          <AdminNavItem to="/admin/pause-reasons" label={t('tenantAdmin.nav.pauseReasons')}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <rect x="4.2" y="3.2" width="2.1" height="8.6" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <rect x="8.7" y="3.2" width="2.1" height="8.6" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="7.5" cy="7.5" r="5.9" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </AdminNavItem>
        )}

        <AdminNavItem to="/admin/quick-replies" label={t('tenantAdmin.nav.quickReplies')}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="M8.8 1.5L3 8.2h4.2L5.8 13.5l6.2-7H7.6L8.8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </AdminNavItem>

        <AdminNavItem to="/admin/conversation-tags" label={t('tenantAdmin.nav.conversationTags')}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="M1.8 2h5l6.2 6.2-4.8 4.8L2 6.8V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <circle cx="4.8" cy="4.8" r="1" fill="currentColor" />
          </svg>
        </AdminNavItem>

        <AdminNavItem to="/admin/settings" label={t('tenantAdmin.nav.settings')}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M7.5 1.5v1.5M7.5 12v1.5M1.5 7.5H3M12 7.5h1.5M3.2 3.2l1.1 1.1M10.7 10.7l1.1 1.1M3.2 11.8l1.1-1.1M10.7 4.3l1.1-1.1"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </AdminNavItem>
      </aside>

      {/* Page content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  );
}
