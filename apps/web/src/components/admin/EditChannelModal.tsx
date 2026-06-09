import { useEffect, useState } from 'react';
import type { AxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface Props {
  open: boolean;
  channelId: string | null;
  onClose: () => void;
}

interface FormState {
  name: string;
  status: 'active' | 'inactive';
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function EditChannelModal({ open, channelId, onClose }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    name: '',
    status: 'active',
    phoneNumberId: '',
    wabaId: '',
    accessToken: '',
  });

  const { data: channel, isLoading } = useQuery({
    queryKey: ['admin', 'channel', channelId],
    queryFn: () => adminApi.getChannel(channelId!),
    enabled: open && Boolean(channelId),
  });

  useEffect(() => {
    if (!channel) return;
    const credentials = (channel.credentials ?? {}) as Record<string, unknown>;
    setForm({
      name: channel.name,
      status: channel.status === 'inactive' ? 'inactive' : 'active',
      phoneNumberId: asString(credentials.phoneNumberId),
      wabaId: asString(credentials.wabaId),
      accessToken: '',
    });
  }, [channel]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!channelId || !channel) return;
      let credentials: Record<string, unknown> | undefined;
      if (channel.type === 'whatsapp') {
        const currentCredentials = (channel.credentials ?? {}) as Record<string, unknown>;
        const phoneNumberId = form.phoneNumberId.trim();
        const wabaId = form.wabaId.trim();
        const credentialsChanged = (
          phoneNumberId !== asString(currentCredentials.phoneNumberId)
          || wabaId !== asString(currentCredentials.wabaId)
          || Boolean(form.accessToken.trim())
        );

        if (credentialsChanged) {
          credentials = { phoneNumberId, wabaId };
        }
        if (form.accessToken.trim()) {
          credentials!.accessToken = form.accessToken.trim();
        }
      }

      await adminApi.updateChannel(channelId, {
        name: form.name.trim(),
        status: form.status,
        ...(credentials ? { credentials } : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'channels'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'channel', channelId] });
      toast.success('Configurações do canal atualizadas');
      onClose();
    },
    onError: (error: AxiosError<{ error?: { message?: string } }>) => {
      toast.error(error.response?.data?.error?.message ?? 'Erro ao salvar configurações do canal');
    },
  });

  const canSave = form.name.trim().length > 0;

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={channel ? `Configurar canal - ${channel.name}` : 'Configurar canal'}
      maxWidth="md"
    >
      {isLoading || !channel ? (
        <div style={{ color: 'var(--txt-3)', fontSize: 13 }}>Carregando canal...</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <Input
            label="Nome do canal"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
              Status
            </label>
            <select
              aria-label="Status do canal"
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as FormState['status'] }))}
              style={{
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                color: 'var(--txt)',
                height: '2.5rem',
                borderRadius: '0.5rem',
                padding: '0 0.75rem',
                fontSize: '0.875rem',
                width: '100%',
              }}
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </div>

          {channel.type === 'whatsapp' && (
            <>
              <Input
                label="Phone Number ID"
                value={form.phoneNumberId}
                onChange={(event) => setForm((prev) => ({ ...prev, phoneNumberId: event.target.value }))}
              />
              <Input
                label="WABA ID"
                value={form.wabaId}
                onChange={(event) => setForm((prev) => ({ ...prev, wabaId: event.target.value }))}
              />
              <Input
                label="Access Token"
                type="password"
                placeholder="Deixe em branco para manter o atual"
                value={form.accessToken}
                onChange={(event) => setForm((prev) => ({ ...prev, accessToken: event.target.value }))}
                hint="Preencha apenas para alterar o token atual"
              />
              <div
                className="rounded-lg p-3"
                style={{ background: 'var(--teal-dim)', border: '1px solid rgba(0,201,167,.25)' }}
              >
                <p className="text-xs" style={{ color: 'var(--teal)' }}>
                  O webhook de entrada será validado e configurado automaticamente ao salvar.
                </p>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
              {mutation.isPending ? 'Salvando...' : 'Salvar configurações'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
