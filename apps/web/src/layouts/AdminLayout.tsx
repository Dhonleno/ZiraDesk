import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Permission } from '@ziradesk/shared';
import { usePermission } from '../hooks/usePermission';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  permission?: Permission;
}

interface NavGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
}

const ICON_SIZE = 16;
const STORAGE_PREFIX = 'zd-admin-nav-';

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'team',
    label: 'nav.groups.team',
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="6" cy="5.2" r="2.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2.2 12c0-2.2 1.8-3.8 3.8-3.8 2.1 0 3.8 1.6 3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M10.3 5.4a1.8 1.8 0 1 0 0 3.6" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
    items: [
      {
        label: 'nav.users',
        path: '/admin/users',
        permission: 'users:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="5.2" r="2.3" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2.5 12.8c0-2.5 2.3-4.3 5.5-4.3s5.5 1.8 5.5 4.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        label: 'nav.departments',
        path: '/admin/departments',
        permission: 'users:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1.5" y="5" width="5" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9.5" y="1.5" width="5" height="12.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6.5 9H9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        label: 'nav.permissions',
        path: '/admin/roles',
        permission: 'users:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 1.8 3 3.8v4.2c0 3.2 2.1 5.9 5 6.8 2.9-.9 5-3.6 5-6.8V3.8L8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="m6.3 7.9 1.4 1.4 2.7-2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        label: 'nav.pauseReasons',
        path: '/admin/pause-reasons',
        permission: 'users:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="4.6" y="3.3" width="2.2" height="9.4" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9.2" y="3.3" width="2.2" height="9.4" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="8" cy="8" r="6.1" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        ),
      },
    ],
  },
  {
    key: 'attendance',
    label: 'nav.groups.attendance',
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2.2" y="2.5" width="11.6" height="8.6" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="m5 10.8-2.4 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
    items: [
      {
        label: 'nav.channels',
        path: '/admin/channels',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2.7 11.8V5.4L8 2.3l5.3 3.1v6.4H2.7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M5.8 11.8V9h4.4v2.8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        label: 'nav.businessHours',
        path: '/admin/business-hours',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 4.6V8l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        label: 'nav.voiceConfig',
        path: '/admin/voice-config',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4.2 2.4h2l1 3-1.5 1.2a10.2 10.2 0 0 0 3.7 3.7l1.2-1.5 3 1v2c0 .8-.6 1.4-1.4 1.4A9.8 9.8 0 0 1 2.8 3.8c0-.8.6-1.4 1.4-1.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        label: 'nav.attendanceRules',
        path: '/admin/attendance-rules',
        permission: 'settings:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="6" cy="4" r="1.5" fill="var(--bg-2)" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="10" cy="8" r="1.5" fill="var(--bg-2)" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="5" cy="12" r="1.5" fill="var(--bg-2)" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        ),
      },
      {
        label: 'nav.autoDistribution',
        path: '/admin/auto-assign',
        permission: 'users:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 12.2h10M4.2 9.6 6.4 7.4l1.6 1.6 3-3 1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="4.2" cy="5.2" r="1.2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="11.8" cy="10.3" r="1.2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ),
      },
      {
        label: 'nav.conversationClosing',
        path: '/admin/close-config',
        permission: 'users:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3.2 4.3h9.6M3.2 8h9.6M3.2 11.7h9.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="5.2" cy="4.3" r="1.1" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="10.6" cy="8" r="1.1" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="7.2" cy="11.7" r="1.1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ),
      },
      {
        label: 'nav.queueConfig',
        path: '/admin/queue-config',
        permission: 'settings:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2.5 4h11M2.5 8h7M2.5 12h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="12" cy="11" r="2.2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M12 9v.5M12 12.5V13M10.5 11h.5M13 11h.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        label: 'nav.ticketAutoAssign',
        path: '/admin/ticket-auto-assign',
        permission: 'settings:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6.8 4.8h2.7M4.8 6.8v2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M9 6.8h2a1 1 0 0 1 1 1V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        label: 'nav.tags',
        path: '/admin/conversation-tags',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 2.4h5l6.6 6.6L8.4 14.2 2 7.8V2.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <circle cx="5.1" cy="5.1" r="0.9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ),
      },
    ],
  },
  {
    key: 'automation',
    label: 'nav.groups.automation',
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2.7" y="4.3" width="10.6" height="7.7" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 7.3h.01M10.5 7.3h.01M6 9.8h4M8 2v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
    items: [
      {
        label: 'nav.supportBot',
        path: '/admin/bot',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2.7" y="4.3" width="10.6" height="7.7" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.5 7.3h.01M10.5 7.3h.01M6 9.8h4M8 2v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        label: 'nav.skills',
        path: '/admin/skills',
        permission: 'users:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2.2 12h11.6M3.6 9.3 6 6.9l1.8 1.4 3.1-3.1 1.5 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="3.6" cy="4.9" r="1.2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="12" cy="9.3" r="1.2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ),
      },
      {
        label: 'nav.aiAgent',
        path: '/admin/ai-agent',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 2.3a5.7 5.7 0 1 0 0 11.4 5.7 5.7 0 0 0 0-11.4Z" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.7 8a2.3 2.3 0 1 1 4.6 0 2.3 2.3 0 0 1-4.6 0Z" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 1v1.4M8 13.6V15M1 8h1.4M13.6 8H15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        label: 'nav.quickReplies',
        path: '/admin/quick-replies',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M9.4 1.6 3.2 8.6h4.4L6 14.4l6.8-7.4H8.3l1.1-5.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        label: 'nav.templates',
        path: '/admin/templates',
        permission: 'settings:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 2.5h6l2 2v9H4v-11Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M10 2.5V4.5H12M6 7h4M6 9.3h4M6 11.6h2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    key: 'tickets',
    label: 'nav.groups.tickets',
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3 4.6h10a1.2 1.2 0 0 1 1.2 1.2v1.1a1 1 0 0 0-.8.9.98.98 0 0 0 .8.9v1.2A1.2 1.2 0 0 1 13 12.1H3a1.2 1.2 0 0 1-1.2-1.2V9.7a1 1 0 0 0 .8-.9 1 1 0 0 0-.8-.9V5.8A1.2 1.2 0 0 1 3 4.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    ),
    items: [
      {
        label: 'nav.ticketTypes',
        path: '/admin/ticket-types',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 4.6h10a1.2 1.2 0 0 1 1.2 1.2v1.1a1 1 0 0 0-.8.9.98.98 0 0 0 .8.9v1.2A1.2 1.2 0 0 1 13 12.1H3a1.2 1.2 0 0 1-1.2-1.2V9.7a1 1 0 0 0 .8-.9 1 1 0 0 0-.8-.9V5.8A1.2 1.2 0 0 1 3 4.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M6 6.7h4M6 9h2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        label: 'nav.ticketCategories',
        path: '/admin/ticket-categories',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 4.5h12M2 8h8M2 11.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="13" cy="11.5" r="2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ),
      },
    ],
  },
  {
    key: 'integrations',
    label: 'nav.groups.integrations',
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M5 3.2h6v2.7H5V3.2ZM5 10.1h6v2.7H5v-2.7Z" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3.2 8h1.6M11.2 8h1.6M8 5.9V8M8 8v2.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    items: [
      {
        label: 'nav.integrations',
        path: '/admin/integrations',
        permission: 'settings:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M5 3.2h6v2.7H5V3.2ZM5 10.1h6v2.7H5v-2.7Z" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3.2 8h1.6M11.2 8h1.6M8 5.9V8M8 8v2.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        label: 'nav.webhooks',
        path: '/admin/webhooks',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M5.8 8a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 0 0-4.4 0Z" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 5.8V2.5M8 13.5V10.2M5.8 8H2.5M13.5 8H10.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="m4.2 4.2 1.5 1.5M10.3 10.3l1.5 1.5M4.2 11.8l1.5-1.5M10.3 5.7l1.5-1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    key: 'settings',
    label: 'nav.groups.settings',
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 2.4v1.5M8 12.1v1.5M2.4 8h1.5M12.1 8h1.5M4 4l1.1 1.1M10.9 10.9 12 12M4 12l1.1-1.1M10.9 5.1 12 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
    items: [
      {
        label: 'nav.lgpd',
        path: '/admin/lgpd',
        permission: 'lgpd:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 1.8 3 3.8v4.2c0 3.2 2.1 5.9 5 6.8 2.9-.9 5-3.6 5-6.8V3.8L8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M6.1 7.8 7.3 9l2.6-2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        label: 'nav.settings',
        path: '/admin/settings',
        permission: 'settings:manage',
        icon: (
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 2.4v1.5M8 12.1v1.5M2.4 8h1.5M12.1 8h1.5M4 4l1.1 1.1M10.9 10.9 12 12M4 12l1.1-1.1M10.9 5.1 12 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
];

function isItemActive(pathname: string, itemPath: string) {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

function getInitialCollapsedState() {
  const state: Record<string, boolean> = {};
  NAV_GROUPS.forEach((group) => {
    if (typeof window === 'undefined') {
      state[group.key] = false;
      return;
    }
    const saved = window.localStorage.getItem(`${STORAGE_PREFIX}${group.key}`);
    state[group.key] = saved === 'collapsed';
  });
  return state;
}

export function AdminLayout() {
  const { t } = useTranslation('admin');
  const { can } = usePermission();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => getInitialCollapsedState());

  useEffect(() => {
    NAV_GROUPS.forEach((group) => {
      const hasActive = group.items.some((item) => isItemActive(location.pathname, item.path));
      if (hasActive) {
        setCollapsed((prev) => ({ ...prev, [group.key]: false }));
      }
    });
  }, [location.pathname]);

  const toggleGroup = (groupKey: string) => {
    setCollapsed((prev) => {
      const nextCollapsed = !prev[groupKey];
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          `${STORAGE_PREFIX}${groupKey}`,
          nextCollapsed ? 'collapsed' : 'expanded',
        );
      }
      return { ...prev, [groupKey]: nextCollapsed };
    });
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <style>
        {`
          .admin-nav-group-header:hover {
            color: var(--txt-2);
            background: var(--bg-4);
          }

          .admin-nav-group-items {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .admin-nav-group + .admin-nav-group {
            border-top: 1px solid var(--line);
            margin-top: 4px;
            padding-top: 4px;
          }
        `}
      </style>

      <aside
        style={{
          width: 220,
          minWidth: 220,
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 10px',
          gap: 2,
          background: 'var(--bg-2)',
          borderRight: '1px solid var(--line)',
          overflowY: 'auto',
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--txt-3)',
            padding: '0 12px 8px',
          }}
        >
          {t('nav.admin')}
        </p>

        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => !item.permission || can(item.permission));
          if (visibleItems.length === 0) return null;

          const isCollapsed = collapsed[group.key] ?? false;

          return (
            <div key={group.key} className="admin-nav-group">
              <button
                type="button"
                className="admin-nav-group-header"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!isCollapsed}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '6px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--r)',
                  cursor: 'pointer',
                  color: 'var(--txt-3)',
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  transition: 'background 0.12s, color 0.12s',
                  marginTop: 4,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {group.icon}
                  {t(group.label)}
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  style={{
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform .2s',
                  }}
                  aria-hidden
                >
                  <path
                    d="M2 4l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {!isCollapsed && (
                <div className="admin-nav-group-items">
                  {visibleItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
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
                      {item.icon}
                      <span>{t(item.label)}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </aside>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  );
}
