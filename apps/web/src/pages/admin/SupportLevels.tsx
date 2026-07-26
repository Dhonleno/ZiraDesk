import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

type Level = 'n1' | 'n2' | 'n3';

interface SupportLevelsForm {
  support_levels_enabled: boolean;
  support_level_n1_dept: string | null;
  support_level_n2_dept: string | null;
  support_level_n3_dept: string | null;
  support_level_n1_label: string;
  support_level_n2_label: string;
  support_level_n3_label: string;
}

const DEFAULTS: SupportLevelsForm = {
  support_levels_enabled: false,
  support_level_n1_dept: null,
  support_level_n2_dept: null,
  support_level_n3_dept: null,
  support_level_n1_label: 'N1',
  support_level_n2_label: 'N2',
  support_level_n3_label: 'N3',
};

const LEVELS: Level[] = ['n1', 'n2', 'n3'];

export function SupportLevels() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: adminApi.departments.list,
    staleTime: 5 * 60_000,
  });

  const [form, setForm] = useState<SupportLevelsForm | null>(null);

  const current: SupportLevelsForm = form ?? {
    support_levels_enabled: data?.support_levels_enabled ?? DEFAULTS.support_levels_enabled,
    support_level_n1_dept: data?.support_level_n1_dept ?? DEFAULTS.support_level_n1_dept,
    support_level_n2_dept: data?.support_level_n2_dept ?? DEFAULTS.support_level_n2_dept,
    support_level_n3_dept: data?.support_level_n3_dept ?? DEFAULTS.support_level_n3_dept,
    support_level_n1_label: data?.support_level_n1_label ?? DEFAULTS.support_level_n1_label,
    support_level_n2_label: data?.support_level_n2_label ?? DEFAULTS.support_level_n2_label,
    support_level_n3_label: data?.support_level_n3_label ?? DEFAULTS.support_level_n3_label,
  };

  const mutation = useMutation({
    mutationFn: (values: SupportLevelsForm) => adminApi.updateSettings(values),
    onSuccess: () => {
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
      toast.success(t('tenantAdmin.supportLevels.saved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const update = (patch: Partial<SupportLevelsForm>) => setForm({ ...current, ...patch });

  const activeDepartments = departments.filter((department) => department.isActive);

  return (
    <PageShell padding={0}>
      <div style={{ maxWidth: 640, padding: '28px 28px 60px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>
            {t('tenantAdmin.supportLevels.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
            {t('tenantAdmin.supportLevels.subtitle')}
          </div>
        </div>

        {isLoading ? (
          <div style={{ fontSize: 13, color: 'var(--txt-3)' }}>{t('tenantAdmin.common.errorLoad')}</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 'var(--r)', border: '1px solid var(--line)', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
                  {t('tenantAdmin.supportLevels.enabled')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}>
                  {t('tenantAdmin.supportLevels.enabledHint')}
                </div>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, flexShrink: 0 }}>
                <input
                  type="checkbox"
                  style={{ opacity: 0, width: 0, height: 0 }}
                  checked={current.support_levels_enabled}
                  onChange={(event) => update({ support_levels_enabled: event.target.checked })}
                />
                <span
                  style={{
                    position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: current.support_levels_enabled ? 'var(--teal)' : 'var(--line-2)',
                    borderRadius: 10, transition: '.2s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', content: '""', height: 14, width: 14, left: 3, bottom: 3,
                      backgroundColor: '#fff', borderRadius: '50%', transition: '.2s',
                      transform: current.support_levels_enabled ? 'translateX(16px)' : 'none',
                    }}
                  />
                </span>
              </label>
            </div>

            {current.support_levels_enabled ? (
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '4px 16px', marginBottom: 24 }}>
                <div className="support-level-head">
                  <span>{t('tenantAdmin.supportLevels.levelLabel')}</span>
                  <span>{t('tenantAdmin.supportLevels.department')}</span>
                </div>

                {LEVELS.map((level) => {
                  const labelKey = `support_level_${level}_label` as const;
                  const deptKey = `support_level_${level}_dept` as const;

                  return (
                    <div key={level} className="support-level-row">
                      <input
                        type="text"
                        value={current[labelKey]}
                        onChange={(event) => update({ [labelKey]: event.target.value } as Partial<SupportLevelsForm>)}
                        placeholder={level.toUpperCase()}
                        maxLength={20}
                        aria-label={`${t('tenantAdmin.supportLevels.levelLabel')} ${level.toUpperCase()}`}
                      />
                      <select
                        value={current[deptKey] ?? ''}
                        onChange={(event) => update({ [deptKey]: event.target.value || null } as Partial<SupportLevelsForm>)}
                        aria-label={`${t('tenantAdmin.supportLevels.department')} ${level.toUpperCase()}`}
                      >
                        <option value="">{t('tenantAdmin.supportLevels.noDept')}</option>
                        {activeDepartments.map((department) => (
                          <option key={department.id} value={department.id}>{department.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <button
              type="button"
              className="zd-btn zd-btn-primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(current)}
            >
              {mutation.isPending ? t('tenantAdmin.common.saving') : t('save', { ns: 'common' })}
            </button>
          </>
        )}
      </div>
    </PageShell>
  );
}
