import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, omnichannelApi, type TenantUser } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';

interface Props {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onTransferred?: (agent: { id: string; name: string }) => Promise<void>;
}

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  const delta = Date.now() - new Date(lastSeenAt).getTime();
  return delta < 5 * 60 * 1000;
}

function avatar(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function TransferModal({ open, conversationId, onClose, onTransferred }: Props) {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const debouncedSearch = useDebounce(search, 250);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedId(null);
    setReason('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  const { data: usersPage, isLoading: loadingUsers } = useQuery({
    queryKey: ['transfer-users', debouncedSearch],
    queryFn: () =>
      adminApi.listUsers({
        page: 1,
        per_page: 100,
        role: 'agent',
        status: 'active',
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      }),
    enabled: open,
  });

  const users = useMemo(() => usersPage?.data ?? [], [usersPage?.data]);
  const selectedAgent = users.find((user) => user.id === selectedId) ?? null;

  const transferMutation = useMutation({
    mutationFn: async (payload: { userId: string; reason?: string }) =>
      omnichannelApi.transfer(conversationId, payload.userId, payload.reason),
    onSuccess: async (_conversation, payload) => {
      const agent = users.find((user) => user.id === payload.userId);
      if (agent && onTransferred) {
        await onTransferred({ id: agent.id, name: agent.name });
      }
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      toast.success(t('transfer.transferred', { name: agent?.name ?? '' }));
      onClose();
    },
    onError: () => toast.error(t('transfer.error', { defaultValue: 'Erro ao transferir conversa' })),
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'var(--backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>{t('transfer.title')}</div>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('transfer.searchAgent')}
            style={{
              width: '100%',
              background: 'var(--bg-3)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r)',
              color: 'var(--txt)',
              fontSize: 13,
              fontFamily: 'var(--font)',
              padding: '9px 11px',
              outline: 'none',
            }}
          />

          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
              background: 'var(--bg-3)',
            }}
          >
            {loadingUsers ? (
              <div style={{ padding: 12, color: 'var(--txt-3)', fontSize: 12 }}>{t('history.loading')}</div>
            ) : users.length === 0 ? (
              <div style={{ padding: 12, color: 'var(--txt-3)', fontSize: 12 }}>{t('transfer.empty', { defaultValue: 'Nenhum agente encontrado' })}</div>
            ) : (
              users.map((user: TenantUser) => {
                const selected = selectedId === user.id;
                const online = isOnline(user.last_seen_at);
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setSelectedId(user.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: selected ? 'var(--teal-dim)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--line)',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg,#667eea,#764ba2)',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                      }}
                    >
                      {avatar(user.name)}
                      <span
                        style={{
                          position: 'absolute',
                          right: -1,
                          bottom: -1,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: online ? 'var(--green)' : 'var(--txt-3)',
                          border: '1px solid var(--bg-3)',
                        }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500 }}>{user.name}</div>
                      <div style={{ fontSize: 11, color: online ? 'var(--green)' : 'var(--txt-3)' }}>
                        {online ? t('transfer.online', { defaultValue: 'Online' }) : t('transfer.offline', { defaultValue: 'Offline' })}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--txt-2)', marginBottom: 6 }}>
              {t('transfer.reason')}
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('transfer.reasonPlaceholder')}
              style={{
                width: '100%',
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                color: 'var(--txt)',
                fontFamily: 'var(--font)',
                fontSize: 13,
                padding: '10px 12px',
                resize: 'vertical',
                outline: 'none',
                minHeight: 78,
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={transferMutation.isPending}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)',
                background: 'var(--bg-4)',
                color: 'var(--txt-2)',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'var(--font)',
              }}
            >
              {t('transfer.cancel', { defaultValue: 'Cancelar' })}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!selectedAgent) return;
                const payload: { userId: string; reason?: string } = { userId: selectedAgent.id };
                if (reason.trim()) payload.reason = reason.trim();
                transferMutation.mutate(payload);
              }}
              disabled={!selectedAgent || transferMutation.isPending}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: '#0E1A18',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--font)',
                opacity: !selectedAgent || transferMutation.isPending ? 0.65 : 1,
              }}
            >
              {t('transfer.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
