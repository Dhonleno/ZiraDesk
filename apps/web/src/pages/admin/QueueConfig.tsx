import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface QueueConfigData {
  queue_notifications_enabled: boolean;
  queue_message_template: string;
  queue_throttle_seconds: number;
  agent_assume_template: string;
  expire_24h_action: 'close' | 'keep_open';
  expire_24h_message: string;
}

export function QueueConfig() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const defaultConfig: QueueConfigData = {
    queue_notifications_enabled: true,
    queue_message_template: t('tenantAdmin.queueConfig.defaultPositionMessage'),
    queue_throttle_seconds: 60,
    agent_assume_template: t('tenantAdmin.queueConfig.defaultAgentAssumeMessage'),
    expire_24h_action: 'close',
    expire_24h_message: t('tenantAdmin.queueConfig.defaultExpireMessage'),
  };

  const { data, isLoading } = useQuery<QueueConfigData>({
    queryKey: ['queue-config'],
    queryFn: () => adminApi.getQueueConfig(),
  });

  const [form, setForm] = useState<QueueConfigData | null>(null);
  const current = form ?? data ?? defaultConfig;

  const mutation = useMutation({
    mutationFn: (payload: Partial<QueueConfigData>) => adminApi.updateQueueConfig(payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(['queue-config'], saved);
      setForm(null);
      toast.success(t('tenantAdmin.queueConfig.messages.saved'));
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const handleChange = <K extends keyof QueueConfigData>(key: K, value: QueueConfigData[K]) => {
    setForm((prev) => ({ ...(prev ?? current), [key]: value }));
  };

  const handleSave = () => {
    mutation.mutate(form ?? current);
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--txt-2)',
    marginBottom: 6,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    background: 'var(--bg-3)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r)',
    color: 'var(--txt)',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    resize: 'vertical',
    minHeight: 80,
    fontFamily: 'var(--mono)',
    fontSize: 12,
  };
  const hintStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--txt-3)',
    marginTop: 4,
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 20,
  };

  return (
    <PageShell padding={0}>
      <div style={{ maxWidth: 640, padding: '28px 28px 60px', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>
            {t('tenantAdmin.queueConfig.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
            {t('tenantAdmin.queueConfig.subtitle')}
          </div>
        </div>

        {isLoading ? (
          <div style={{ fontSize: 13, color: 'var(--txt-3)' }}>
            {t('tenantAdmin.common.errorLoad')}
          </div>
        ) : (
          <>
            {/* Toggle: notificações ativas */}
            <div style={{ ...rowStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 'var(--r)', border: '1px solid var(--line)', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
                  {t('tenantAdmin.queueConfig.enabled')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}>
                  {t('tenantAdmin.queueConfig.enabledHint')}
                </div>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, flexShrink: 0 }}>
                <input
                  type="checkbox"
                  style={{ opacity: 0, width: 0, height: 0 }}
                  checked={current.queue_notifications_enabled}
                  onChange={(e) => handleChange('queue_notifications_enabled', e.target.checked)}
                />
                <span
                  onClick={() => handleChange('queue_notifications_enabled', !current.queue_notifications_enabled)}
                  style={{
                    position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: current.queue_notifications_enabled ? 'var(--teal)' : 'var(--line-2)',
                    borderRadius: 10,
                    transition: '.2s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', content: '', height: 14, width: 14,
                      left: current.queue_notifications_enabled ? 19 : 3,
                      bottom: 3, backgroundColor: 'white', borderRadius: '50%', transition: '.2s',
                    }}
                  />
                </span>
              </label>
            </div>

            {/* Mensagem de posição na fila */}
            <div style={rowStyle}>
              <label style={labelStyle}>{t('tenantAdmin.queueConfig.positionMessage')}</label>
              <textarea
                style={textareaStyle}
                value={current.queue_message_template}
                onChange={(e) => handleChange('queue_message_template', e.target.value)}
                placeholder={t('tenantAdmin.queueConfig.positionPlaceholder')}
              />
              <div style={hintStyle}>{t('tenantAdmin.queueConfig.positionMessageHint')}</div>
            </div>

            {/* Throttle */}
            <div style={rowStyle}>
              <label style={labelStyle}>{t('tenantAdmin.queueConfig.throttle')}</label>
              <input
                type="number"
                style={{ ...inputStyle, width: 140 }}
                min={30}
                max={600}
                value={current.queue_throttle_seconds}
                onChange={(e) => handleChange('queue_throttle_seconds', Number(e.target.value))}
              />
              <div style={hintStyle}>{t('tenantAdmin.queueConfig.throttleHint')}</div>
            </div>

            {/* Saudação ao assumir */}
            <div style={rowStyle}>
              <label style={labelStyle}>{t('tenantAdmin.queueConfig.agentAssumeMessage')}</label>
              <textarea
                style={textareaStyle}
                value={current.agent_assume_template}
                onChange={(e) => handleChange('agent_assume_template', e.target.value)}
                placeholder={t('tenantAdmin.queueConfig.agentNamePlaceholder')}
              />
              <div style={hintStyle}>{t('tenantAdmin.queueConfig.agentAssumeMessageHint')}</div>
            </div>

            {/* Ação após 24h */}
            <div style={rowStyle}>
              <label style={labelStyle}>{t('tenantAdmin.queueConfig.expire24hAction')}</label>
              <select
                style={{ ...inputStyle, width: 220 }}
                value={current.expire_24h_action}
                onChange={(e) => handleChange('expire_24h_action', e.target.value as 'close' | 'keep_open')}
              >
                <option value="close">{t('tenantAdmin.queueConfig.expire24hClose')}</option>
                <option value="keep_open">{t('tenantAdmin.queueConfig.expire24hKeepOpen')}</option>
              </select>
            </div>

            {/* Mensagem ao encerrar por 24h (condicional) */}
            {current.expire_24h_action === 'close' && (
              <div style={rowStyle}>
                <label style={labelStyle}>{t('tenantAdmin.queueConfig.expire24hMessage')}</label>
                <textarea
                  style={textareaStyle}
                  value={current.expire_24h_message}
                  onChange={(e) => handleChange('expire_24h_message', e.target.value)}
                />
              </div>
            )}

            {/* Botão salvar */}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="tb-btn tb-btn-primary"
                onClick={handleSave}
                disabled={mutation.isPending}
              >
                {mutation.isPending
                  ? t('tenantAdmin.common.saving')
                  : t('tenantAdmin.common.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
