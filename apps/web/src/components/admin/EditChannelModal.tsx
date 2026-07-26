import { useEffect, useState } from 'react';
import type { AxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  appId: string;
  appSecret: string;
  accessToken: string;
  defaultDepartmentId: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function EditChannelModal({ open, channelId, onClose }: Props) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    name: '',
    status: 'active',
    phoneNumberId: '',
    wabaId: '',
    appId: '',
    appSecret: '',
    accessToken: '',
    defaultDepartmentId: '',
  });

  const { data: channel, isLoading } = useQuery({
    queryKey: ['admin', 'channel', channelId],
    queryFn: () => adminApi.getChannel(channelId!),
    enabled: open && Boolean(channelId),
  });

  const isEmailChannel = channel?.type === 'email';

  const { data: inboundData } = useQuery({
    queryKey: ['admin', 'email-inbound-address'],
    queryFn: adminApi.getEmailInboundAddress,
    enabled: open && isEmailChannel,
    staleTime: 5 * 60_000,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: adminApi.departments.list,
    enabled: open && isEmailChannel,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!channel) return;
    const credentials = (channel.credentials ?? {}) as Record<string, unknown>;
    const settings = (channel.settings ?? {}) as Record<string, unknown>;
    setForm({
      name: channel.name,
      status: channel.status === 'inactive' ? 'inactive' : 'active',
      phoneNumberId: asString(credentials.phoneNumberId),
      wabaId: asString(credentials.wabaId),
      appId: asString(credentials.appId),
      appSecret: '',
      accessToken: '',
      defaultDepartmentId: asString(settings.default_department_id),
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
        const appId = form.appId.trim();
        const credentialsChanged = (
          phoneNumberId !== asString(currentCredentials.phoneNumberId)
          || wabaId !== asString(currentCredentials.wabaId)
          || appId !== asString(currentCredentials.appId)
          || Boolean(form.appSecret.trim())
          || Boolean(form.accessToken.trim())
        );

        if (credentialsChanged) {
          credentials = { phoneNumberId, wabaId, appId };
        }
        if (form.appSecret.trim()) {
          credentials!.appSecret = form.appSecret.trim();
        }
        if (form.accessToken.trim()) {
          credentials!.accessToken = form.accessToken.trim();
        }
      }

      // settings é mesclado no backend (channels.service), então enviar só a
      // chave do departamento não apaga o restante.
      const settings = channel.type === 'email'
        ? {
            inbound_email_address: inboundData?.address ?? '',
            default_department_id: form.defaultDepartmentId || null,
          }
        : undefined;

      await adminApi.updateChannel(channelId, {
        name: form.name.trim(),
        status: form.status,
        ...(credentials ? { credentials } : {}),
        ...(settings ? { settings } : {}),
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
                label="App ID"
                value={form.appId}
                onChange={(event) => setForm((prev) => ({ ...prev, appId: event.target.value }))}
              />
              <Input
                label="App Secret"
                type="password"
                placeholder="Deixe em branco para manter o atual"
                value={form.appSecret}
                onChange={(event) => setForm((prev) => ({ ...prev, appSecret: event.target.value }))}
                hint="Preencha apenas para alterar o segredo atual"
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

          {isEmailChannel && (
            <>
              <div className="channel-config-section">
                <h4 className="channel-config-section-title">
                  {t('tenantAdmin.channels.email.inboundTitle')}
                </h4>
                <p className="channel-config-section-desc">
                  {t('tenantAdmin.channels.email.inboundDesc')}
                </p>

                <div className="inbound-address-row">
                  <code className="inbound-address-code">
                    {inboundData?.address ?? '…'}
                  </code>
                  <button
                    type="button"
                    className="inbound-copy-btn"
                    disabled={!inboundData?.address}
                    onClick={() => {
                      void navigator.clipboard.writeText(inboundData?.address ?? '');
                      toast.success(t('copied', { ns: 'common' }));
                    }}
                  >
                    {t('copy', { ns: 'common' })}
                  </button>
                </div>

                <ol className="inbound-steps">
                  <li>{t('tenantAdmin.channels.email.step1')}</li>
                  <li>{t('tenantAdmin.channels.email.step2')}</li>
                  <li>{t('tenantAdmin.channels.email.step3')}</li>
                </ol>
              </div>

              <div className="channel-config-field">
                <label htmlFor="channel-default-dept">
                  {t('tenantAdmin.channels.email.defaultDept')}
                </label>
                <p className="channel-config-hint">
                  {t('tenantAdmin.channels.email.defaultDeptHint')}
                </p>
                <select
                  id="channel-default-dept"
                  value={form.defaultDepartmentId}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultDepartmentId: event.target.value }))}
                >
                  <option value="">{t('tenantAdmin.channels.email.noDept')}</option>
                  {departments.filter((department) => department.isActive).map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
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
