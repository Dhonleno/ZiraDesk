import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ticketsApi, adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface Props {
  ticketId: string | null;
  onClose: () => void;
}

export function AssignTicketModal({ ticketId, onClose }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data: usersData } = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => {
      const p: Parameters<typeof adminApi.listUsers>[0] = { per_page: 20 };
      if (search) p.search = search;
      return adminApi.listUsers(p);
    },
    staleTime: 30_000,
    enabled: !!ticketId,
  });

  const mutation = useMutation({
    mutationFn: () => ticketsApi.assign(ticketId!, selectedUserId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      toast.success(t('tickets.form.assigned'));
      onClose();
    },
    onError: () => toast.error('Erro ao atribuir ticket'),
  });

  const users = usersData?.data ?? [];

  return (
    <Modal open={!!ticketId} onClose={onClose} title={t('tickets.actions.assign')} maxWidth="sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="text"
          placeholder={t('tickets.form.searchUser')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            height: '2.25rem', width: '100%', boxSizing: 'border-box',
            padding: '0 10px', borderRadius: 'var(--r)', fontSize: 13,
            background: 'var(--bg-3)', border: '1px solid var(--line)',
            color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflowY: 'auto' }}>
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setSelectedUserId(selectedUserId === u.id ? null : u.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 'var(--r)', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: selectedUserId === u.id ? 'var(--teal-dim)' : 'transparent',
                color: 'var(--txt)', fontFamily: 'var(--font)',
                outline: selectedUserId === u.id ? '1px solid var(--teal)' : 'none',
              }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, var(--purple), #8B5CF6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: '#fff',
              }}>
                {u.name.charAt(0).toUpperCase()}
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{u.email}</div>
              </div>
              {selectedUserId === u.id && (
                <svg style={{ marginLeft: 'auto', color: 'var(--teal)' }} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
          {users.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--txt-3)', textAlign: 'center', padding: '16px 0' }}>
              Nenhum usuário encontrado
            </p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!selectedUserId}
            onClick={() => mutation.mutate()}
          >
            {t('tickets.actions.assign')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
