import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { Button } from '../../components/ui/Button';
import { AddChannelModal } from '../../components/admin/AddChannelModal';
import { EditChannelModal } from '../../components/admin/EditChannelModal';
import { PageShell } from '../../components/layout/PageShell';

interface Channel {
  id: string;
  type: string;
  name: string;
  status: string;
  settings: unknown;
  created_at: string;
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  whatsapp: {
    label: 'WhatsApp',
    color: '#25D366',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    ),
  },
  instagram: {
    label: 'Instagram DM',
    color: '#E1306C',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    ),
  },
  email: {
    label: 'E-mail',
    color: 'var(--blue)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  webchat: {
    label: 'Web Chat',
    color: 'var(--teal)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
};

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const isActive = status === 'active';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: isActive ? 'var(--green-dim)' : 'var(--red-dim)',
        color: isActive ? 'var(--green)' : 'var(--red)',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: isActive ? 'var(--green)' : 'var(--red)' }}
      />
      {isActive ? t('tenantAdmin.channels.status.active') : t('tenantAdmin.channels.status.inactive')}
    </span>
  );
}

export function Channels() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editChannelId, setEditChannelId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'channels'],
    queryFn: adminApi.listChannels,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteChannel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'channels'] });
      toast.success(t('tenantAdmin.channels.messages.deleted'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => adminApi.testChannel(id),
    onSuccess: (res) => {
      if (res.data.connected) {
        toast.success(t('tenantAdmin.channels.messages.testSuccess'));
      } else {
        toast.error(t('tenantAdmin.channels.messages.testFail'));
      }
    },
    onError: () => toast.error(t('tenantAdmin.channels.messages.testFail')),
  });

  const toggleMutation = useMutation({
    mutationFn: (channel: Channel) => (
      adminApi.updateChannel(channel.id, {
        status: channel.status === 'active' ? 'inactive' : 'active',
      })
    ),
    onSuccess: async (_res, channel) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'channels'] });
      toast.success(channel.status === 'active' ? 'Canal desativado' : 'Canal ativado');
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const channels = data ?? [];

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
        <div className="flex items-start justify-between">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', color: 'var(--txt)' }}>
            {t('tenantAdmin.channels.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.channels.subtitle')}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t('tenantAdmin.channels.add')}
        </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-bg-3" />
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Object.entries(TYPE_META).map(([type, meta]) => (
              <button
                key={type}
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex flex-col items-center gap-3 rounded-xl p-6 transition-all"
                style={{ background: 'var(--bg-2)', border: `1px dashed ${meta.color}40` }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = meta.color + '80';
                  e.currentTarget.style.background = 'var(--bg-3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = meta.color + '40';
                  e.currentTarget.style.background = 'var(--bg-2)';
                }}
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ background: meta.color + '1A', color: meta.color }}
                >
                  {meta.icon}
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>{meta.label}</p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--txt-3)' }}>
                    {t('tenantAdmin.channels.clickToAdd')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(channels as Channel[]).map((channel) => {
              const meta = TYPE_META[channel.type] ?? { label: 'Canal', color: 'var(--txt-2)', icon: null };
              return (
                <div
                  key={channel.id}
                  className="rounded-xl p-5"
                  style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)' }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-lg"
                        style={{ background: meta.color + '1A', color: meta.color }}
                      >
                        {meta.icon}
                      </div>
                      <div>
                        <p className="font-medium" style={{ color: 'var(--txt)' }}>{channel.name}</p>
                        <p className="text-xs" style={{ color: 'var(--txt-3)' }}>{meta.label}</p>
                      </div>
                    </div>
                    <StatusBadge status={channel.status} t={t} />
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => testMutation.mutate(channel.id)}
                      disabled={testMutation.isPending}
                      className="zd-btn"
                      style={{ flex: 1, justifyContent: 'center' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--txt)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--txt-2)'; }}
                    >
                      {t('tenantAdmin.common.test')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditChannelId(channel.id)}
                      className="zd-btn"
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--txt)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--txt-2)'; }}
                    >
                      Configurar
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMutation.mutate(channel)}
                      disabled={toggleMutation.isPending}
                      className="zd-btn"
                      style={{ borderColor: 'var(--blue)', background: 'var(--blue-dim)', color: 'var(--blue)' }}
                    >
                      {channel.status === 'active' ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(channel.id)}
                      className="zd-btn"
                      style={{ borderColor: 'var(--red)', background: 'var(--red-dim)', color: 'var(--red)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(248,113,113,.25)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--red-dim)'; }}
                    >
                      {t('tenantAdmin.common.remove')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <AddChannelModal open={addOpen} onClose={() => setAddOpen(false)} />
        <EditChannelModal
          open={Boolean(editChannelId)}
          channelId={editChannelId}
          onClose={() => setEditChannelId(null)}
        />
      </div>
    </PageShell>
  );
}
