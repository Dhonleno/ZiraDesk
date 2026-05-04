import { useEffect, useMemo, useState } from 'react';
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
  verifyToken: string;
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
    verifyToken: '',
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
      verifyToken: asString(credentials.verifyToken),
    });
  }, [channel]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!channelId || !channel) return;
      const credentials: Record<string, unknown> = {};
      if (channel.type === 'whatsapp') {
        credentials.phoneNumberId = form.phoneNumberId.trim();
        credentials.wabaId = form.wabaId.trim();
        credentials.verifyToken = form.verifyToken.trim();
        if (form.accessToken.trim()) {
          credentials.accessToken = form.accessToken.trim();
        }
      }

      await adminApi.updateChannel(channelId, {
        name: form.name.trim(),
        status: form.status,
        credentials,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'channels'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'channel', channelId] });
      toast.success('Configurações do canal atualizadas');
      onClose();
    },
    onError: () => toast.error('Erro ao salvar configurações do canal'),
  });

  const webhookUrl = useMemo(() => `${window.location.origin}/api/webhooks/whatsapp`, []);
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
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as FormState['status'] }))}
              style={{
                background: 'var(--bg-3)',
                border: '1px solid var(--line)',
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
              <Input
                label="Verify Token"
                value={form.verifyToken}
                onChange={(event) => setForm((prev) => ({ ...prev, verifyToken: event.target.value }))}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                  URL do Webhook
                </label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={webhookUrl}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                      background: 'var(--bg-2)',
                      color: 'var(--txt-3)',
                      padding: '0 10px',
                      fontSize: 12,
                      fontFamily: 'var(--mono)',
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(webhookUrl);
                      toast.success('Webhook copiado');
                    }}
                  >
                    Copiar
                  </Button>
                </div>
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
