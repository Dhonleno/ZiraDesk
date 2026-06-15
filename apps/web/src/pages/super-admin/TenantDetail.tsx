import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../stores/toast.store';

type TenantStatus = 'active' | 'trial' | 'suspended' | 'cancelled';
type TenantUserRole = 'owner' | 'admin' | 'agent' | 'viewer';

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  status: TenantStatus;
  trialEndsAt: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  plan: { id: string; name: string; slug: string; priceMonth: string };
  subscriptions: Array<{
    id: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    paymentGateway: string | null;
  }>;
}

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: TenantUserRole;
  status: 'active' | 'inactive';
  last_seen_at: string | null;
  created_at: string;
}

interface TenantUsersResponse {
  success: boolean;
  data: TenantUser[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
}

interface TenantUserInviteResponse {
  success: boolean;
  data: {
    user: TenantUser;
    tempPassword: string;
  };
}

const statusVariant: Record<TenantStatus, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  trial: 'info',
  suspended: 'error',
  cancelled: 'neutral',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-800/50">
      <p className="w-40 shrink-0 text-sm text-gray-500">{label}</p>
      <p className="text-sm text-gray-200">{value}</p>
    </div>
  );
}

export function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TenantUserRole>('admin');
  const [resetUser, setResetUser] = useState<TenantUser | null>(null);

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['super-admin', 'tenant', id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: TenantDetail }>(`/super-admin/tenants/${id!}`);
      return res.data.data;
    },
    enabled: Boolean(id),
  });

  const { data: usersData, isLoading: isUsersLoading } = useQuery({
    queryKey: ['super-admin', 'tenant-users', id],
    queryFn: async () => {
      const res = await api.get<TenantUsersResponse>(`/super-admin/tenants/${id!}/users`, {
        params: { page: 1, per_page: 100 },
      });
      return res.data;
    },
    enabled: Boolean(id),
  });

  const actionMutation = useMutation({
    mutationFn: async (action: 'suspend' | 'activate') =>
      api.post(`/super-admin/tenants/${id!}/${action}`),
    onSuccess: (_data, action) => {
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenant', id] });
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenants'] });
      toast.success(
        action === 'suspend'
          ? t('superAdmin.tenants.messages.suspended')
          : t('superAdmin.tenants.messages.activated'),
      );
    },
    onError: () => toast.error('Erro ao executar ação'),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<TenantUserInviteResponse>(`/super-admin/tenants/${id!}/users`, {
        name: inviteName,
        email: inviteEmail,
        role: inviteRole,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setInviteOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('admin');
      void qc.invalidateQueries({ queryKey: ['super-admin', 'tenant-users', id] });
      toast.success(t('superAdmin.tenants.access.messages.userCreated'));
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (user: TenantUser) => {
      await api.post(`/super-admin/tenants/${id!}/users/${user.id}/reset-password`);
      return user;
    },
    onSuccess: (user) => {
      setResetUser(null);
      toast.success(t('superAdmin.tenants.access.resetEmailSent', { name: user.name }));
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const roleLabel = (role: TenantUserRole) => {
    if (role === 'owner') return t('tenantAdmin.users.roles.owner');
    if (role === 'admin') return t('tenantAdmin.users.roles.admin');
    if (role === 'agent') return t('tenantAdmin.users.roles.agent');
    return t('tenantAdmin.users.roles.viewer');
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-800" />
        ))}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="text-center py-16 text-gray-500">
        Tenant não encontrado.{' '}
        <Link to="/super-admin/tenants" className="text-brand-400 hover:underline">
          Voltar
        </Link>
      </div>
    );
  }

  const sub = tenant.subscriptions[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/super-admin/tenants" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            ← Tenants
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-white">{tenant.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-sm text-gray-500">{tenant.slug}.ziradesk.com</span>
            <Badge variant={statusVariant[tenant.status]}>
              {t(`superAdmin.tenants.status.${tenant.status}`)}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {tenant.status !== 'suspended' && tenant.status !== 'cancelled' && (
            <Button
              variant="danger"
              size="sm"
              loading={actionMutation.isPending}
              onClick={() => actionMutation.mutate('suspend')}
            >
              {t('superAdmin.tenants.actions.suspend')}
            </Button>
          )}
          {tenant.status === 'suspended' && (
            <Button
              size="sm"
              loading={actionMutation.isPending}
              onClick={() => actionMutation.mutate('activate')}
            >
              {t('superAdmin.tenants.actions.activate')}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-1">
        <InfoRow label="ID" value={tenant.id} />
        <InfoRow label="Schema" value={tenant.schemaName} />
        <InfoRow label="Plano" value={`${tenant.plan.name} — R$ ${Number(tenant.plan.priceMonth).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês`} />
        <InfoRow label="Criado em" value={new Date(tenant.createdAt).toLocaleString('pt-BR')} />
        {tenant.trialEndsAt && (
          <InfoRow label="Trial até" value={new Date(tenant.trialEndsAt).toLocaleDateString('pt-BR')} />
        )}
      </div>

      <div className="rounded-xl border border-line bg-bg-2 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-sm font-semibold" style={{ color: 'var(--txt)' }}>
              {t('superAdmin.tenants.access.title')}
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--txt-3)' }}>
              {t('superAdmin.tenants.access.subtitle')}
            </p>
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            {t('superAdmin.tenants.access.createLogin')}
          </Button>
        </div>

        {isUsersLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-9 animate-pulse rounded-md" style={{ background: 'var(--bg-3)' }} />
            ))}
          </div>
        ) : (usersData?.data.length ?? 0) === 0 ? (
          <div className="rounded-lg px-4 py-5 text-sm" style={{ border: '1px solid var(--line)', color: 'var(--txt-3)' }}>
            {t('superAdmin.tenants.access.empty')}
          </div>
        ) : (
          <div className="overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] border-collapse">
              <thead style={{ background: 'var(--bg-3)' }}>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                    {t('tenantAdmin.users.fields.name')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                    {t('tenantAdmin.users.fields.email')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                    {t('tenantAdmin.users.fields.role')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                    {t('tenantAdmin.users.fields.status')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                    {t('superAdmin.tenants.access.table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {usersData?.data.map((user) => (
                  <tr key={user.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td className="px-3 py-2 text-sm" style={{ color: 'var(--txt)' }}>{user.name}</td>
                    <td className="px-3 py-2 text-sm" style={{ color: 'var(--txt-2)' }}>{user.email}</td>
                    <td className="px-3 py-2 text-sm" style={{ color: 'var(--txt-2)' }}>{roleLabel(user.role)}</td>
                    <td className="px-3 py-2 text-sm">
                      <Badge variant={user.status === 'active' ? 'success' : 'neutral'}>
                        {t(`tenantAdmin.users.status.${user.status}`)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setResetUser(user)}
                      >
                        {t('tenantAdmin.users.resetPassword')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sub && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-4 text-sm font-medium text-gray-400">Assinatura atual</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-gray-500">Status</p>
              <p className="mt-1 text-gray-200 font-medium">{sub.status}</p>
            </div>
            <div>
              <p className="text-gray-500">Período início</p>
              <p className="mt-1 text-gray-200">{new Date(sub.currentPeriodStart).toLocaleDateString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-gray-500">Período fim</p>
              <p className="mt-1 text-gray-200">{new Date(sub.currentPeriodEnd).toLocaleDateString('pt-BR')}</p>
            </div>
            {sub.paymentGateway && (
              <div>
                <p className="text-gray-500">Gateway</p>
                <p className="mt-1 text-gray-200">{sub.paymentGateway}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('superAdmin.tenants.access.createLogin')}
        maxWidth="md"
        maxWidthPx={500}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            inviteMutation.mutate();
          }}
        >
          <Input
            label={t('tenantAdmin.users.fields.name')}
            value={inviteName}
            onChange={(event) => setInviteName(event.target.value)}
            required
          />
          <Input
            label={t('tenantAdmin.users.fields.email')}
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            required
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
              {t('tenantAdmin.users.fields.role')}
            </label>
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as TenantUserRole)}
              style={{
                width: '100%',
                height: 40,
                borderRadius: 8,
                border: '1px solid var(--line-2)',
                background: 'var(--bg-3)',
                color: 'var(--txt)',
                padding: '0 12px',
                fontSize: 14,
              }}
            >
              <option value="admin">{t('tenantAdmin.users.roles.admin')}</option>
              <option value="agent">{t('tenantAdmin.users.roles.agent')}</option>
              <option value="viewer">{t('tenantAdmin.users.roles.viewer')}</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setInviteOpen(false)}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <Button type="submit" loading={inviteMutation.isPending}>
              {t('tenantAdmin.common.save')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!resetUser}
        onClose={() => setResetUser(null)}
        title={t('tenantAdmin.users.resetPassword')}
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.users.messages.resetPasswordConfirm', {
              name: resetUser?.name ?? '',
              email: resetUser?.email ?? '',
            })}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setResetUser(null)}>
              {t('tenantAdmin.common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={resetPasswordMutation.isPending}
              onClick={() => {
                if (!resetUser) return;
                resetPasswordMutation.mutate(resetUser);
              }}
            >
              {t('tenantAdmin.users.resetPassword')}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
