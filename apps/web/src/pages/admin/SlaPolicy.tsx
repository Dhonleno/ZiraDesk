import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

type Priority = 'urgent' | 'high' | 'medium' | 'low';

interface SlaForm {
  sla_auto_enabled: boolean;
  sla_hours_urgent: number;
  sla_hours_high: number;
  sla_hours_medium: number;
  sla_hours_low: number;
}

const DEFAULTS: SlaForm = {
  sla_auto_enabled: false,
  sla_hours_urgent: 4,
  sla_hours_high: 8,
  sla_hours_medium: 24,
  sla_hours_low: 72,
};

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low'];

export function SlaPolicy() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  const [form, setForm] = useState<SlaForm | null>(null);

  const current: SlaForm = form ?? {
    sla_auto_enabled: data?.sla_auto_enabled ?? DEFAULTS.sla_auto_enabled,
    sla_hours_urgent: data?.sla_hours_urgent ?? DEFAULTS.sla_hours_urgent,
    sla_hours_high: data?.sla_hours_high ?? DEFAULTS.sla_hours_high,
    sla_hours_medium: data?.sla_hours_medium ?? DEFAULTS.sla_hours_medium,
    sla_hours_low: data?.sla_hours_low ?? DEFAULTS.sla_hours_low,
  };

  const mutation = useMutation({
    mutationFn: (values: SlaForm) => adminApi.updateSettings(values),
    onSuccess: () => {
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success(t('tenantAdmin.slaPolicy.messages.saved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const update = (patch: Partial<SlaForm>) => setForm({ ...current, ...patch });

  return (
    <PageShell padding={0}>
      <div style={{ maxWidth: 640, padding: '28px 28px 60px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>
            {t('tenantAdmin.slaPolicy.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
            {t('tenantAdmin.slaPolicy.subtitle')}
          </div>
        </div>

        {isLoading ? (
          <div style={{ fontSize: 13, color: 'var(--txt-3)' }}>{t('tenantAdmin.common.errorLoad')}</div>
        ) : (
          <>
            {/* Toggle: SLA automático */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 'var(--r)', border: '1px solid var(--line)', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
                  {t('tenantAdmin.slaPolicy.autoEnabled')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}>
                  {t('tenantAdmin.slaPolicy.description')}
                </div>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, flexShrink: 0 }}>
                <input
                  type="checkbox"
                  style={{ opacity: 0, width: 0, height: 0 }}
                  checked={current.sla_auto_enabled}
                  onChange={(e) => update({ sla_auto_enabled: e.target.checked })}
                />
                <span
                  onClick={() => update({ sla_auto_enabled: !current.sla_auto_enabled })}
                  style={{
                    position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: current.sla_auto_enabled ? 'var(--teal)' : 'var(--line-2)',
                    borderRadius: 10, transition: '.2s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', height: 14, width: 14,
                      left: current.sla_auto_enabled ? 19 : 3,
                      bottom: 3, backgroundColor: 'white', borderRadius: '50%', transition: '.2s',
                    }}
                  />
                </span>
              </label>
            </div>

            {/* Horas por prioridade */}
            {current.sla_auto_enabled ? (
              <div className="sla-hours-grid">
                {PRIORITIES.map((p) => (
                  <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)' }}>
                      {t(`tenantAdmin.slaPolicy.priority.${p}`)}
                    </label>
                    <div className="sla-hours-input">
                      <input
                        type="number"
                        min={1}
                        max={8760}
                        value={current[`sla_hours_${p}` as keyof SlaForm] as number}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (Number.isFinite(value)) update({ [`sla_hours_${p}`]: value } as Partial<SlaForm>);
                        }}
                      />
                      <span>{t('tenantAdmin.slaPolicy.hours')}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ marginTop: 24 }}>
              <button
                type="button"
                className="tb-btn tb-btn-primary"
                onClick={() => mutation.mutate(current)}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
