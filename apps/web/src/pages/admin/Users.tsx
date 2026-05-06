import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { InviteUserModal } from '../../components/admin/InviteUserModal';
import { EditUserModal } from '../../components/admin/EditUserModal';
import { ResetPasswordModal } from '../../components/admin/ResetPasswordModal';

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
}

const ROLE_STYLES: Record<string, { bg: string; color: string }> = {
  owner:  { bg: 'var(--purple-dim)', color: 'var(--purple)' },
  admin:  { bg: 'var(--teal-dim)',   color: 'var(--teal)' },
  agent:  { bg: 'var(--blue-dim)',   color: 'var(--blue)' },
  viewer: { bg: 'rgba(156,163,175,.15)', color: 'var(--txt-2)' },
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  active:   { bg: 'var(--green-dim)', color: 'var(--green)' },
  inactive: { bg: 'var(--red-dim)',   color: 'var(--red)' },
};

function RoleBadge({ role, label }: { role: string; label: string }) {
  const s = ROLE_STYLES[role] ?? { bg: 'rgba(156,163,175,.15)', color: 'var(--txt-2)' };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const s = STATUS_STYLES[status] ?? { bg: 'var(--red-dim)', color: 'var(--red)' };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {label}
    </span>
  );
}

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(iso));
}

const ROLE_TABS = ['all', 'owner', 'admin', 'agent', 'viewer'] as const;
const STATUS_TABS = ['all', 'active', 'inactive'] as const;

type RoleFilter = (typeof ROLE_TABS)[number];
type StatusFilter = (typeof STATUS_TABS)[number];

function FilterTabs<T extends string>({
  tabs,
  active,
  onChange,
  labelFn,
}: {
  tabs: readonly T[];
  active: T;
  onChange: (v: T) => void;
  labelFn: (v: T) => string;
}) {
  return (
    <div className="flex gap-1" style={{ background: 'var(--bg-3)', borderRadius: '0.5rem', padding: '3px', border: '1px solid var(--line-2)' }}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            background: active === tab ? 'var(--bg-4)' : 'transparent',
            color: active === tab ? 'var(--txt)' : 'var(--txt-2)',
          }}
        >
          {labelFn(tab)}
        </button>
      ))}
    </div>
  );
}

export function Users() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<TenantUser | null>(null);
  const [resetUser, setResetUser] = useState<TenantUser | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', debouncedSearch, roleFilter, statusFilter, page],
    queryFn: () => {
      const params: Record<string, string | number> = { page, per_page: 20 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (roleFilter !== 'all') params.role = roleFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      return adminApi.listUsers(params as Parameters<typeof adminApi.listUsers>[0]);
    },
  });

  function resetFilters(changes: Partial<{ role: RoleFilter; status: StatusFilter; search: string }>) {
    setPage(1);
    if ('role' in changes) setRoleFilter(changes.role!);
    if ('status' in changes) setStatusFilter(changes.status!);
    if ('search' in changes) setSearch(changes.search!);
  }

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(t('tenantAdmin.users.messages.deactivated'));
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => adminApi.updateUser(id, { status: 'active' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(t('tenantAdmin.users.messages.reactivated'));
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const roleLabel = (role: string) => {
    const map: Record<string, string> = {
      all:    t('tenantAdmin.common.all'),
      owner:  t('tenantAdmin.users.roles.owner'),
      admin:  t('tenantAdmin.users.roles.admin'),
      agent:  t('tenantAdmin.users.roles.agent'),
      viewer: t('tenantAdmin.users.roles.viewer'),
    };
    return map[role] ?? role;
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      all:      t('tenantAdmin.common.all'),
      active:   t('tenantAdmin.users.status.active'),
      inactive: t('tenantAdmin.users.status.inactive'),
    };
    return map[status] ?? status;
  };

  const meta = data?.meta;
  const users: TenantUser[] = data?.data ?? [];

  const TABLE_HEADERS = [
    t('tenantAdmin.users.fields.name'),
    t('tenantAdmin.users.fields.role'),
    t('tenantAdmin.users.fields.status'),
    t('tenantAdmin.users.fields.lastSeen'),
    t('tenantAdmin.users.fields.createdAt'),
    '',
  ];

  return (
    <div className="space-y-5 p-6" style={{ overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', color: 'var(--txt)' }}>
            {t('tenantAdmin.users.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            {meta ? `${meta.total} ${meta.total === 1 ? 'membro' : 'membros'} no total` : t('tenantAdmin.users.subtitle')}
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t('tenantAdmin.users.invite')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:w-72">
            <Input
              placeholder={t('tenantAdmin.users.search')}
              aria-label={t('tenantAdmin.users.search')}
              value={search}
              onChange={(e) => resetFilters({ search: e.target.value })}
            />
          </div>
          <FilterTabs
            tabs={ROLE_TABS}
            active={roleFilter}
            onChange={(v) => resetFilters({ role: v })}
            labelFn={roleLabel}
          />
          <FilterTabs
            tabs={STATUS_TABS}
            active={statusFilter}
            onChange={(v) => resetFilters({ status: v })}
            labelFn={statusLabel}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--line)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--line)' }}>
              {TABLE_HEADERS.map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-left text-xs font-medium"
                  style={{ color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10, fontWeight: 600 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-bg-3" />
                      </td>
                    ))}
                  </tr>
                ))
              : users.map((user) => (
                  <tr
                    key={user.id}
                    style={{
                      borderBottom: '1px solid var(--line)',
                      background: 'var(--bg)',
                      opacity: user.status === 'inactive' ? 0.65 : 1,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-2)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                          style={{ background: 'var(--bg-4)', color: 'var(--txt-2)' }}
                        >
                          {initials(user.name)}
                        </div>
                        <div>
                          <p className="font-medium" style={{ color: 'var(--txt)' }}>{user.name}</p>
                          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} label={roleLabel(user.role)} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={user.status} label={statusLabel(user.status)} />
                    </td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: 'var(--txt-2)' }}>
                      {formatDate(user.last_seen_at)}
                    </td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: 'var(--txt-2)' }}>
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {user.role !== 'owner' && (
                        <div className="flex items-center justify-end gap-1">
                          {user.status === 'active' ? (
                            <>
                              <ActionButton onClick={() => setEditUser(user)}>
                                {t('tenantAdmin.common.edit')}
                              </ActionButton>
                              <ActionButton onClick={() => setResetUser(user)} color="var(--txt-2)">
                                {t('tenantAdmin.users.resetPassword')}
                              </ActionButton>
                              <ActionButton
                                onClick={() => deactivateMutation.mutate(user.id)}
                                color="var(--red)"
                                hoverBg="var(--red-dim)"
                              >
                                {t('tenantAdmin.common.deactivate')}
                              </ActionButton>
                            </>
                          ) : (
                            <ActionButton
                              onClick={() => reactivateMutation.mutate(user.id)}
                              color="var(--green)"
                              hoverBg="var(--green-dim)"
                            >
                              {t('tenantAdmin.common.reactivate')}
                            </ActionButton>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!isLoading && users.length === 0 && (
          <div style={{ padding: 16, minHeight: 260 }}>
            <div className="zd-empty-state">
              <div className="zd-empty-icon" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M4.8 18c0-3 2.5-4.8 6.2-4.8S17.2 15 17.2 18" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>{t('tenantAdmin.users.noUsers')}</div>
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>Ajuste os filtros ou convide um novo usuário.</div>
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--txt-2)' }}>
          <span>
            {((page - 1) * 20) + 1}–{Math.min(page * 20, meta.total)} de {meta.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 1}
              className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                color: page === 1 ? 'var(--txt-3)' : 'var(--txt)',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
              }}
            >
              ← Anterior
            </button>
            <span className="flex items-center px-2 text-xs">
              Página {page} de {meta.total_pages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page === meta.total_pages}
              className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                color: page === meta.total_pages ? 'var(--txt-3)' : 'var(--txt)',
                cursor: page === meta.total_pages ? 'not-allowed' : 'pointer',
              }}
            >
              Próxima →
            </button>
          </div>
        </div>
      )}

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <EditUserModal open={!!editUser} onClose={() => setEditUser(null)} user={editUser} />
      <ResetPasswordModal open={!!resetUser} onClose={() => setResetUser(null)} user={resetUser} />
    </div>
  );
}

function ActionButton({
  onClick,
  color = 'var(--txt-2)',
  hoverBg = 'var(--bg-4)',
  children,
}: {
  onClick: () => void;
  color?: string;
  hoverBg?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-2 py-1 text-xs transition-colors"
      style={{ color, background: 'transparent' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverBg;
        if (color === 'var(--txt-2)') e.currentTarget.style.color = 'var(--txt)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        if (color === 'var(--txt-2)') e.currentTarget.style.color = 'var(--txt-2)';
      }}
    >
      {children}
    </button>
  );
}
