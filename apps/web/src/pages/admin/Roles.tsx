import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { hasPermission, ROLE_PERMISSIONS, type Permission, type Role } from '@ziradesk/shared';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { PageShell } from '../../components/layout/PageShell';
import { adminApi, type TenantSettings } from '../../services/api';
import { usePermission } from '../../hooks/usePermission';
import { useAuthStore } from '../../stores/auth.store';
import { useToast } from '../../stores/toast.store';

type AgentPermissionKey =
  | 'agent_can_delete_tickets'
  | 'agent_can_export_tickets'
  | 'agent_can_manage_contacts'
  | 'agent_can_view_reports'
  | 'agent_can_transfer_conversations'
  | 'agent_can_manage_campaigns';

type AgentPermissionsForm = Record<AgentPermissionKey, boolean>;

const AGENT_PERMISSIONS_DEFAULTS: AgentPermissionsForm = {
  agent_can_delete_tickets: false,
  agent_can_export_tickets: true,
  agent_can_manage_contacts: true,
  agent_can_view_reports: true,
  agent_can_transfer_conversations: true,
  agent_can_manage_campaigns: true,
};

const AGENT_PERMISSION_KEYS: AgentPermissionKey[] = [
  'agent_can_delete_tickets',
  'agent_can_export_tickets',
  'agent_can_manage_contacts',
  'agent_can_view_reports',
  'agent_can_transfer_conversations',
  'agent_can_manage_campaigns',
];

function agentPermissionsFromSettings(settings?: TenantSettings): AgentPermissionsForm {
  return {
    agent_can_delete_tickets: settings?.agent_can_delete_tickets ?? AGENT_PERMISSIONS_DEFAULTS.agent_can_delete_tickets,
    agent_can_export_tickets: settings?.agent_can_export_tickets ?? AGENT_PERMISSIONS_DEFAULTS.agent_can_export_tickets,
    agent_can_manage_contacts: settings?.agent_can_manage_contacts ?? AGENT_PERMISSIONS_DEFAULTS.agent_can_manage_contacts,
    agent_can_view_reports: settings?.agent_can_view_reports ?? AGENT_PERMISSIONS_DEFAULTS.agent_can_view_reports,
    agent_can_transfer_conversations:
      settings?.agent_can_transfer_conversations ?? AGENT_PERMISSIONS_DEFAULTS.agent_can_transfer_conversations,
    agent_can_manage_campaigns: settings?.agent_can_manage_campaigns ?? AGENT_PERMISSIONS_DEFAULTS.agent_can_manage_campaigns,
  };
}

// Mesmo pill-switch usado em SlaPolicy.tsx/TicketAutoAssign.tsx/CustomFields.tsx
// — não há um componente <Toggle> compartilhado no projeto ainda.
function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, flexShrink: 0 }}>
      <input
        type="checkbox"
        style={{ opacity: 0, width: 0, height: 0 }}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        onClick={() => onChange(!checked)}
        style={{
          position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: checked ? 'var(--teal)' : 'var(--line-2)',
          borderRadius: 10, transition: '.2s',
        }}
      >
        <span
          style={{
            position: 'absolute', height: 14, width: 14,
            left: checked ? 19 : 3,
            bottom: 3, backgroundColor: 'white', borderRadius: '50%', transition: '.2s',
          }}
        />
      </span>
    </label>
  );
}

type AssignableRole = Exclude<Role, 'super_admin'> | 'supervisor';

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

type RoleChangeErrorCode = 'CANNOT_CHANGE_OWN_ROLE' | 'ONLY_OWNER_CAN_ASSIGN_OWNER';

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  active: { bg: 'var(--green-dim)', color: 'var(--green)' },
  inactive: { bg: 'var(--red-dim)', color: 'var(--red)' },
};

const VIEWER_FEATURE_FLAGS = [
  'viewer',
  'viewer_role',
  'viewerRole',
  'allow_viewer_role',
  'roles.viewer',
  'rbac.viewer',
] as const;

const PERMISSION_ORDER: Permission[] = [
  'tenant:manage',
  'settings:manage',
  'users:manage',
  'channels:manage',
  'lgpd:manage',
  'contacts:view',
  'contacts:edit',
  'contacts:delete',
  'organizations:view',
  'organizations:edit',
  'organizations:delete',
  'conversations:view',
  'conversations:reply',
  'conversations:manage',
  'tickets:view',
  'tickets:edit',
  'tickets:delete',
  'metrics:view',
  'metrics:own',
];

const MATRIX_ROLES: AssignableRole[] = ['owner', 'admin', 'supervisor', 'agent', 'viewer'];

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() ?? '')
    .join('');
}

function isAssignableRole(value: string): value is AssignableRole {
  return value === 'owner'
    || value === 'admin'
    || value === 'supervisor'
    || value === 'agent'
    || value === 'viewer';
}

function canUseViewerRole(features?: Record<string, unknown>): boolean {
  if (!features) return true;

  for (const key of VIEWER_FEATURE_FLAGS) {
    if (key in features) {
      return Boolean(features[key]);
    }
  }

  return true;
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const style = STATUS_STYLES[status] ?? { bg: 'var(--bg-4)', color: 'var(--txt-2)' };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: style.bg, color: style.color }}
    >
      {label}
    </span>
  );
}

export function Roles() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const toast = useToast();
  const authUser = useAuthStore((state) => state.user);
  const { can, role: currentRole } = usePermission();

  const { data: usersResponse, isLoading } = useQuery({
    queryKey: ['admin', 'roles', 'users'],
    queryFn: () => adminApi.listUsers({ page: 1, per_page: 100 }),
  });

  const { data: settings } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
    enabled: can('settings:manage') || can('users:manage'),
  });

  const viewerEnabled = canUseViewerRole(settings?.plan?.features);

  const [agentPermissionsForm, setAgentPermissionsForm] = useState<AgentPermissionsForm | null>(null);
  const agentPermissions = agentPermissionsForm ?? agentPermissionsFromSettings(settings);

  const updateAgentPermissionsMutation = useMutation({
    mutationFn: (values: AgentPermissionsForm) => adminApi.updateSettings(values),
    onSuccess: () => {
      setAgentPermissionsForm(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success(t('tenantAdmin.agentPermissions.saved'));
    },
    onError: () => toast.error(t('tenantAdmin.agentPermissions.saveError')),
  });

  const availableRoles = useMemo<AssignableRole[]>(() => (
    viewerEnabled
      ? ['owner', 'admin', 'supervisor', 'agent', 'viewer']
      : ['owner', 'admin', 'supervisor', 'agent']
  ), [viewerEnabled]);

  const matrixPermissions = useMemo<Permission[]>(() => {
    const dynamicPermissions = new Set<Permission>();

    (Object.keys(ROLE_PERMISSIONS) as Role[]).forEach((roleKey) => {
      ROLE_PERMISSIONS[roleKey].forEach((permission) => {
        if (String(permission) !== '*') {
          dynamicPermissions.add(permission as Permission);
        }
      });
    });

    PERMISSION_ORDER.forEach((permission) => dynamicPermissions.add(permission));
    return PERMISSION_ORDER.filter((permission) => dynamicPermissions.has(permission));
  }, []);

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AssignableRole }) => (
      adminApi.updateUser(userId, { role })
    ),
    onSuccess: () => {
      toast.success(t('roles.changeRoleSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'roles', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error: unknown) => {
      const typed = error as {
        response?: {
          data?: {
            error?: { code?: RoleChangeErrorCode; message?: string };
          };
        };
      };

      const code = typed.response?.data?.error?.code;
      if (code === 'CANNOT_CHANGE_OWN_ROLE') {
        toast.error(t('roles.cannotChangeSelf'));
        return;
      }

      if (code === 'ONLY_OWNER_CAN_ASSIGN_OWNER') {
        toast.error(t('roles.cannotChangeOwner'));
        return;
      }

      toast.error(typed.response?.data?.error?.message ?? t('roles.changeRoleError'));
    },
  });

  const users: TenantUser[] = usersResponse?.data ?? [];

  const onRoleChange = (targetUser: TenantUser, nextRoleValue: string) => {
    if (!isAssignableRole(nextRoleValue)) return;
    if (!availableRoles.includes(nextRoleValue)) return;
    if (targetUser.role === nextRoleValue) return;

    if (targetUser.id === authUser?.id) {
      toast.error(t('roles.cannotChangeSelf'));
      return;
    }

    if (nextRoleValue === 'owner' && currentRole !== 'owner') {
      toast.error(t('roles.cannotChangeOwner'));
      return;
    }

    updateRoleMutation.mutate({ userId: targetUser.id, role: nextRoleValue });
  };

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
        <header>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', color: 'var(--txt)' }}>
            {t('roles.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('roles.subtitle')}
          </p>
        </header>

        <section className="space-y-3">
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{t('roles.usersTab')}</h2>
          <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--line)', background: 'var(--bg)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--line)' }}>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>{t('tenantAdmin.users.fields.name')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>{t('tenantAdmin.users.fields.email')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>{t('roles.role')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>{t('tenantAdmin.users.fields.status')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>{t('roles.changeRole')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={`skeleton-${index}`} style={{ borderBottom: '1px solid var(--line)' }}>
                        {Array.from({ length: 5 }).map((__, cellIndex) => (
                          <td key={`${index}-${cellIndex}`} className="px-4 py-3">
                            <div className="h-4 animate-pulse rounded" style={{ background: 'var(--bg-3)' }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : users.map((user) => {
                      const userRole = isAssignableRole(user.role) ? user.role : null;
                      const isSelf = user.id === authUser?.id;
                      const isRowPending = updateRoleMutation.isPending && updateRoleMutation.variables?.userId === user.id;

                      return (
                        <tr key={user.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div
                                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
                                style={{ background: 'var(--bg-4)', color: 'var(--txt-2)', fontFamily: "'IBM Plex Mono', monospace" }}
                              >
                                {initials(user.name)}
                              </div>
                              <span style={{ color: 'var(--txt)', fontWeight: 500 }}>{user.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3" style={{ color: 'var(--txt-2)', fontFamily: "'IBM Plex Mono', monospace" }}>
                            {user.email}
                          </td>
                          <td className="px-4 py-3">
                            <PermissionGate
                              permission="users:manage"
                              fallback={(
                                <span style={{ color: 'var(--txt-2)' }}>
                                  {userRole ? t(`roles.roles.${userRole}`) : user.role}
                                </span>
                              )}
                            >
                              {userRole ? (
                                <select
                                  aria-label={t('roles.role')}
                                  value={userRole}
                                  disabled={isSelf || isRowPending}
                                  onChange={(event) => onRoleChange(user, event.target.value)}
                                  style={{
                                    minWidth: 160,
                                    borderRadius: 8,
                                    border: '1px solid var(--line-2)',
                                    background: 'var(--bg-2)',
                                    color: 'var(--txt)',
                                    padding: '7px 10px',
                                    fontSize: 13,
                                    fontFamily: "'IBM Plex Sans', sans-serif",
                                    cursor: isSelf ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {availableRoles.map((roleOption) => (
                                    <option key={roleOption} value={roleOption}>
                                      {t(`roles.roles.${roleOption}`)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span style={{ color: 'var(--txt-2)' }}>{user.role}</span>
                              )}
                            </PermissionGate>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              status={user.status}
                              label={t(`tenantAdmin.users.status.${user.status}`, { defaultValue: user.status })}
                            />
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: 'var(--txt-3)' }}>
                            {isRowPending ? t('tenantAdmin.common.saving') : '—'}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>{t('roles.matrixTab')}</h2>
          <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--line)', background: 'var(--bg)' }}>
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--line)' }}>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
                    {t('roles.matrixTab')}
                  </th>
                  {MATRIX_ROLES.filter((matrixRole) => viewerEnabled || matrixRole !== 'viewer').map((matrixRole) => (
                    <th key={matrixRole} className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
                      {t(`roles.roles.${matrixRole}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixPermissions.map((permission) => (
                  <tr key={permission} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--txt-2)' }}>
                      {t(`roles.permissions.${permission}`, { nsSeparator: false, defaultValue: permission })}
                    </td>
                    {MATRIX_ROLES.filter((matrixRole) => viewerEnabled || matrixRole !== 'viewer').map((matrixRole) => {
                      const roleForPermission: Role = matrixRole === 'supervisor' ? 'admin' : matrixRole;
                      const allowed = hasPermission(roleForPermission, permission);
                      return (
                        <td
                          key={`${permission}-${matrixRole}`}
                          className="px-4 py-3 text-center"
                          style={{ color: allowed ? 'var(--teal)' : 'var(--txt-3)', fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                          {allowed ? '✓' : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <PermissionGate permission="settings:manage">
          <section className="space-y-3">
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>
              {t('tenantAdmin.agentPermissions.title')}
            </h2>
            <p className="text-sm" style={{ color: 'var(--txt-2)', marginTop: 0 }}>
              {t('tenantAdmin.agentPermissions.subtitle')}
            </p>
            <div className="rounded-xl" style={{ border: '1px solid var(--line)', background: 'var(--bg)' }}>
              {AGENT_PERMISSION_KEYS.map((key, index) => (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 16px',
                    borderBottom: index < AGENT_PERMISSION_KEYS.length - 1 ? '1px solid var(--line)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 13, color: 'var(--txt)' }}>
                    {t(`tenantAdmin.agentPermissions.${key}`)}
                  </span>
                  <Toggle
                    checked={agentPermissions[key]}
                    onChange={(value) => setAgentPermissionsForm({ ...agentPermissions, [key]: value })}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="tb-btn tb-btn-primary"
                onClick={() => updateAgentPermissionsMutation.mutate(agentPermissions)}
                disabled={updateAgentPermissionsMutation.isPending}
              >
                {updateAgentPermissionsMutation.isPending
                  ? t('tenantAdmin.common.saving')
                  : t('tenantAdmin.common.save')}
              </button>
            </div>
          </section>
        </PermissionGate>
      </div>
    </PageShell>
  );
}
