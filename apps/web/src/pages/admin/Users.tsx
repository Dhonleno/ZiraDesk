import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';
import { useAuthStore } from '../../stores/auth.store';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { InviteUserModal } from '../../components/admin/InviteUserModal';
import { EditUserModal } from '../../components/admin/EditUserModal';
import { ResetPasswordModal } from '../../components/admin/ResetPasswordModal';
import { PageShell } from '../../components/layout/PageShell';

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
  max_conversations?: number | null;
}

const ROLE_STYLES: Record<string, { bg: string; color: string }> = {
  owner:  { bg: 'var(--purple-dim)', color: 'var(--purple)' },
  admin:  { bg: 'var(--teal-dim)',   color: 'var(--teal)' },
  supervisor: { bg: 'var(--purple-dim)', color: 'var(--purple)' },
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

const ROLE_TABS = ['all', 'owner', 'admin', 'supervisor', 'agent', 'viewer'] as const;
const STATUS_TABS = ['all', 'active', 'inactive'] as const;

type RoleFilter = (typeof ROLE_TABS)[number];
type StatusFilter = (typeof STATUS_TABS)[number];
type UserStatus = 'active' | 'inactive';
type ConfirmStatusAction = { user: TenantUser; nextStatus: UserStatus } | null;

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

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  confirmColor,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: 'var(--red)' | 'var(--teal)';
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('admin');
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }

    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay, var(--backdrop))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        opacity: entered ? 1 : 0,
        transition: 'opacity 200ms ease-out',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(400px, calc(100vw - 32px))',
          borderRadius: 12,
          border: '1px solid var(--line)',
          background: 'var(--surface, var(--bg-2))',
          boxShadow: 'var(--shadow-pop)',
          transform: entered ? 'scale(1)' : 'scale(0.96)',
          opacity: entered ? 1 : 0,
          transition: 'transform 200ms ease-out, opacity 200ms ease-out',
        }}
      >
        <div style={{ padding: '16px 18px 10px' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--txt)' }}>{title}</h3>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--txt-2)' }}>{message}</p>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '14px 18px 16px',
            borderTop: '1px solid var(--line)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              border: '1px solid var(--line-2)',
              background: 'var(--btn-ghost, var(--bg-3))',
              color: 'var(--txt-2)',
              borderRadius: 'var(--r)',
              fontSize: 12,
              fontWeight: 500,
              padding: '7px 12px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {t('tenantAdmin.common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              border: `1px solid ${confirmColor === 'var(--red)' ? 'var(--danger, var(--red))' : 'var(--teal)'}`,
              background: confirmColor === 'var(--red)' ? 'var(--danger, var(--red))' : 'var(--teal)',
              color: 'var(--on-teal)',
              borderRadius: 'var(--r)',
              fontSize: 12,
              fontWeight: 600,
              padding: '7px 12px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.75 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Users() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const loggedUserId = useAuthStore((state) => state.user?.id);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<TenantUser | null>(null);
  const [resetUser, setResetUser] = useState<TenantUser | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmStatusAction>(null);
  const [openActionsUserId, setOpenActionsUserId] = useState<string | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!actionsMenuRef.current) return;
      if (!actionsMenuRef.current.contains(event.target as Node)) {
        setOpenActionsUserId(null);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

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

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) => adminApi.updateUser(id, { status }),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(
        variables.status === 'inactive'
          ? t('tenantAdmin.users.deactivateSuccess')
          : t('tenantAdmin.users.reactivateSuccess'),
      );
      setConfirmAction(null);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? t('tenantAdmin.users.deactivateError'));
    },
  });

  const roleLabel = (role: string) => {
    const map: Record<string, string> = {
      all:    t('tenantAdmin.common.all'),
      owner:  t('tenantAdmin.users.roles.owner'),
      admin:  t('tenantAdmin.users.roles.admin'),
      supervisor: t('tenantAdmin.users.roles.supervisor'),
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
  const confirmTitle = confirmAction?.nextStatus === 'inactive'
    ? t('tenantAdmin.users.confirmDeactivate')
    : t('tenantAdmin.users.confirmReactivate');
  const confirmMessage = confirmAction
    ? (
      confirmAction.nextStatus === 'inactive'
        ? t('tenantAdmin.users.confirmDeactivateMsg', { name: confirmAction.user.name })
        : t('tenantAdmin.users.confirmReactivateMsg', { name: confirmAction.user.name })
    )
    : '';

  const TABLE_HEADERS = [
    t('tenantAdmin.users.fields.name'),
    t('tenantAdmin.users.fields.role'),
    t('tenantAdmin.users.fields.status'),
    t('tenantAdmin.users.fields.lastSeen'),
    t('tenantAdmin.users.fields.createdAt'),
    t('tenantAdmin.users.fields.actions'),
  ];
  const ACTIONS_COL_WIDTH = 88;

  return (
    <PageShell padding={0}>
      <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', color: 'var(--txt)' }}>
            {t('tenantAdmin.users.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>{t('tenantAdmin.users.subtitle')}</p>
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
                  className={`px-4 py-3 text-xs font-medium ${i === TABLE_HEADERS.length - 1 ? 'text-right' : 'text-left'}`}
                  style={{
                    color: 'var(--txt-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '.08em',
                    fontSize: 10,
                    fontWeight: 600,
                    ...(i === TABLE_HEADERS.length - 1 ? { width: ACTIONS_COL_WIDTH } : {}),
                  }}
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
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--bg)';
                    }}
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
                          <p className="font-medium" style={{ color: 'var(--txt)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {user.name}
                            {user.id === loggedUserId && (
                              <span
                                style={{
                                  background: 'var(--teal-dim)',
                                  color: 'var(--teal)',
                                  borderRadius: 'var(--r-pill)',
                                  border: '1px solid var(--teal)',
                                  fontSize: 11,
                                  fontWeight: 500,
                                  padding: '1px 7px',
                                  lineHeight: 1.2,
                                }}
                              >
                                {t('tenantAdmin.users.youBadge')}
                              </span>
                            )}
                          </p>
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
                    <td className="px-4 py-3 text-right" style={{ width: ACTIONS_COL_WIDTH }}>
                      <PermissionGate permission="users:manage">
                        {user.role !== 'owner' ? (
                          <div
                            ref={openActionsUserId === user.id ? actionsMenuRef : null}
                            className="row-actions flex items-center justify-end"
                            style={{ position: 'relative' }}
                          >
                            <button
                              type="button"
                              onClick={() => setOpenActionsUserId((current) => (current === user.id ? null : user.id))}
                              aria-label={t('tenantAdmin.users.fields.actions')}
                              style={{
                                width: 28,
                                height: 28,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 'var(--r)',
                                border: '1px solid var(--line-2)',
                                background: 'var(--bg-3)',
                                color: 'var(--txt-3)',
                                cursor: 'pointer',
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <circle cx="6" cy="2.5" r="1" fill="currentColor" />
                                <circle cx="6" cy="6" r="1" fill="currentColor" />
                                <circle cx="6" cy="9.5" r="1" fill="currentColor" />
                              </svg>
                            </button>

                            {openActionsUserId === user.id && (
                              <div
                                style={{
                                  position: 'absolute',
                                  right: 0,
                                  top: 'calc(100% + 4px)',
                                  minWidth: 156,
                                  background: 'var(--bg-2)',
                                  border: '1px solid var(--line)',
                                  borderRadius: 'var(--r)',
                                  boxShadow: 'var(--shadow-pop)',
                                  zIndex: 20,
                                  padding: 4,
                                }}
                              >
                                {user.status === 'active' ? (
                                  <>
                                    <DropdownItem onClick={() => { setEditUser(user); setOpenActionsUserId(null); }}>
                                      {t('tenantAdmin.common.edit')}
                                    </DropdownItem>
                                    <DropdownItem onClick={() => { setResetUser(user); setOpenActionsUserId(null); }}>
                                      {t('tenantAdmin.users.resetPassword.title')}
                                    </DropdownItem>
                                    <DropdownItem
                                      color="var(--red)"
                                      disabled={user.id === loggedUserId}
                                      onClick={() => {
                                        setConfirmAction({ user, nextStatus: 'inactive' });
                                        setOpenActionsUserId(null);
                                      }}
                                    >
                                      {t('tenantAdmin.common.deactivate')}
                                    </DropdownItem>
                                  </>
                                ) : (
                                  <DropdownItem
                                    color="var(--teal)"
                                    disabled={user.id === loggedUserId}
                                    onClick={() => {
                                      setConfirmAction({ user, nextStatus: 'active' });
                                      setOpenActionsUserId(null);
                                    }}
                                  >
                                    {t('tenantAdmin.common.reactivate')}
                                  </DropdownItem>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>—</span>
                        )}
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!isLoading && users.length === 0 && (
          <div style={{ padding: 16, minHeight: 260 }}>
            <div className="zd-empty-state">
              <div className="zd-empty-icon" aria-hidden style={{ width: 56, height: 56, color: 'var(--txt-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)' }}>
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="18" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M12.5 35c0-5 4.2-8.2 11.5-8.2S35.5 30 35.5 35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>{t('tenantAdmin.users.emptyTitle')}</div>
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{t('tenantAdmin.users.emptySubtitle')}</div>
              <PermissionGate permission="users:manage">
                <Button onClick={() => setInviteOpen(true)}>
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  {t('tenantAdmin.users.invite')}
                </Button>
              </PermissionGate>
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--txt-2)' }}>
          <span>
            {((page - 1) * 20) + 1}–{Math.min(page * 20, meta.total)}{' '}
            {t('tenantAdmin.users.pagination.of')} {meta.total}
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
              ← {t('tenantAdmin.users.pagination.previous')}
            </button>
            <span className="flex items-center px-2 text-xs">
              {t('tenantAdmin.users.pagination.page')} {page}{' '}
              {t('tenantAdmin.users.pagination.of')} {meta.total_pages}
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
              {t('tenantAdmin.users.pagination.next')} →
            </button>
          </div>
        </div>
      )}

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <EditUserModal open={!!editUser} onClose={() => setEditUser(null)} user={editUser} />
      <ResetPasswordModal open={!!resetUser} onClose={() => setResetUser(null)} user={resetUser} />
      <ConfirmModal
        open={!!confirmAction}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmAction?.nextStatus === 'inactive' ? t('tenantAdmin.common.deactivate') : t('tenantAdmin.common.reactivate')}
        confirmColor={confirmAction?.nextStatus === 'inactive' ? 'var(--red)' : 'var(--teal)'}
        loading={statusMutation.isPending}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (!confirmAction) return;
          statusMutation.mutate({ id: confirmAction.user.id, status: confirmAction.nextStatus });
        }}
      />
      </div>
    </PageShell>
  );
}

function DropdownItem({
  onClick,
  disabled = false,
  color = 'var(--txt-2)',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded px-2 py-1 text-xs transition-colors"
      style={{
        width: '100%',
        textAlign: 'left',
        color: disabled ? 'var(--txt-3)' : color,
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '7px 10px',
        fontSize: 12,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--bg-4)';
        if (color === 'var(--txt-2)') e.currentTarget.style.color = 'var(--txt)';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'transparent';
        if (color === 'var(--txt-2)') e.currentTarget.style.color = 'var(--txt-2)';
      }}
    >
      {children}
    </button>
  );
}
