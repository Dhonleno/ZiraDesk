import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface TicketAutoAssignData {
  ticket_auto_assign: boolean;
}

export function TicketAutoAssign() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const defaultConfig: TicketAutoAssignData = {
    ticket_auto_assign: false,
  };

  const { data, isLoading } = useQuery<TicketAutoAssignData>({
    queryKey: ['ticket-auto-assign'],
    queryFn: () => adminApi.getTicketAutoAssignConfig(),
  });

  const [form, setForm] = useState<TicketAutoAssignData | null>(null);
  const current = form ?? data ?? defaultConfig;

  const mutation = useMutation({
    mutationFn: (payload: TicketAutoAssignData) => adminApi.updateTicketAutoAssignConfig(payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(['ticket-auto-assign'], saved);
      setForm(null);
      toast.success(t('tenantAdmin.ticketAutoAssign.messages.saved'));
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const handleChange = (value: boolean) => {
    setForm({ ticket_auto_assign: value });
  };

  const handleSave = () => {
    mutation.mutate(form ?? current);
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
            {t('tenantAdmin.ticketAutoAssign.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
            {t('tenantAdmin.ticketAutoAssign.subtitle')}
          </div>
        </div>

        {isLoading ? (
          <div style={{ fontSize: 13, color: 'var(--txt-3)' }}>
            {t('tenantAdmin.common.errorLoad')}
          </div>
        ) : (
          <>
            {/* Toggle: auto-assign ativo */}
            <div style={{ ...rowStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 'var(--r)', border: '1px solid var(--line)', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
                  {t('tenantAdmin.ticketAutoAssign.enabled')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}>
                  {t('tenantAdmin.ticketAutoAssign.enabledHint')}
                </div>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, flexShrink: 0 }}>
                <input
                  type="checkbox"
                  style={{ opacity: 0, width: 0, height: 0 }}
                  checked={current.ticket_auto_assign}
                  onChange={(e) => handleChange(e.target.checked)}
                />
                <span
                  onClick={() => handleChange(!current.ticket_auto_assign)}
                  style={{
                    position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: current.ticket_auto_assign ? 'var(--teal)' : 'var(--line-2)',
                    borderRadius: 10,
                    transition: '.2s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', content: '', height: 14, width: 14,
                      left: current.ticket_auto_assign ? 19 : 3,
                      bottom: 3, backgroundColor: 'white', borderRadius: '50%', transition: '.2s',
                    }}
                  />
                </span>
              </label>
            </div>

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
