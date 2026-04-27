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
  owner:  { bg: 'rgba(167,139,250,.15)', color: '#A78BFA' },
  admin:  { bg: 'rgba(0,201,167,.15)',   color: '#00C9A7' },
  agent:  { bg: 'rgba(96,165,250,.15)',  color: '#60A5FA' },
  viewer: { bg: 'rgba(156,163,175,.15)', color: '#9CA3AF' },
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  active:   { bg: 'rgba(62,207,142,.15)',  color: '#3ECF8E' },
  inactive: { bg: 'rgba(248,113,113,.15)', color: '#F87171' },
};

function RoleBadge({ role, label }: { role: string; label: string }) {
  const s = ROLE_STYLES[role] ?? { bg: 'rgba(156,163,175,.15)', color: '#9CA3AF' };
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
  const s = STATUS_STYLES[status] ?? { bg: 'rgba(248,113,113,.15)', color: '#F87171' };
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

const ROLE_TABS = ['all', 'admin', 'agent', 'viewer'] as const;

export function Users() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<TenantUser | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', debouncedSearch, roleFilter],
    queryFn: () => {
      const params: Parameters<typeof adminApi.listUsers>[0] = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (roleFilter !== 'all') params.role = roleFilter;
      return adminApi.listUsers(params);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(t('tenantAdmin.users.messages.deactivated'));
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? 'Erro ao desativar usuário');
    },
  });

  const roleLabel = (role: string) => {
    const map: Record<string, string> = {
      owner: t('tenantAdmin.users.roles.owner'),
      admin: t('tenantAdmin.users.roles.admin'),
      agent: t('tenantAdmin.users.roles.agent'),
      viewer: t('tenantAdmin.users.roles.viewer'),
    };
    return map[role] ?? role;
  };

  const statusLabel = (status: string) => {
    return status === 'active'
      ? t('tenantAdmin.users.status.active')
      : t('tenantAdmin.users.status.inactive');
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F0F1F3' }}>
            {t('tenantAdmin.users.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#9DA3AE' }}>
            {t('tenantAdmin.users.subtitle')}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:w-72">
          <Input
            placeholder={t('tenantAdmin.users.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1" style={{ background: '#141518', borderRadius: '0.5rem', padding: '3px' }}>
          {ROLE_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setRoleFilter(tab)}
              className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: roleFilter === tab ? '#22252B' : 'transparent',
                color: roleFilter === tab ? '#F0F1F3' : '#9DA3AE',
              }}
            >
              {tab === 'all' ? 'Todos' : roleLabel(tab)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ border: '1px solid rgba(255,255,255,.07)' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#141518', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
              {['Usuário', 'Função', 'Status', 'Último acesso', 'Membro desde', ''].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium"
                  style={{ color: '#5C6370' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-bg-3" />
                      </td>
                    ))}
                  </tr>
                ))
              : (data?.data ?? []).map((user: TenantUser) => (
                  <tr
                    key={user.id}
                    style={{ borderBottom: '1px solid rgba(255,255,255,.04)', background: '#0E0F11' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#141518')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#0E0F11')}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                          style={{ background: '#22252B', color: '#9DA3AE' }}
                        >
                          {initials(user.name)}
                        </div>
                        <div>
                          <p className="font-medium" style={{ color: '#F0F1F3' }}>{user.name}</p>
                          <p className="text-xs" style={{ color: '#5C6370' }}>{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} label={roleLabel(user.role)} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={user.status} label={statusLabel(user.status)} />
                    </td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: '#9DA3AE' }}>
                      {formatDate(user.last_seen_at)}
                    </td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: '#9DA3AE' }}>
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {user.role !== 'owner' && (
                          <>
                            <button
                              onClick={() => setEditUser(user)}
                              className="rounded px-2 py-1 text-xs transition-colors"
                              style={{ color: '#9DA3AE', background: 'transparent' }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = '#22252B';
                                e.currentTarget.style.color = '#F0F1F3';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.color = '#9DA3AE';
                              }}
                            >
                              Editar
                            </button>
                            {user.status === 'active' && (
                              <button
                                onClick={() => deactivateMutation.mutate(user.id)}
                                className="rounded px-2 py-1 text-xs transition-colors"
                                style={{ color: '#F87171', background: 'transparent' }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(248,113,113,.1)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                Desativar
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!isLoading && (data?.data ?? []).length === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: '#5C6370' }}>
            Nenhum usuário encontrado
          </div>
        )}
      </div>

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <EditUserModal open={!!editUser} onClose={() => setEditUser(null)} user={editUser} />
    </div>
  );
}
