import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { adminApi } from '../../services/api';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { PageShell } from '../../components/layout/PageShell';
import { useToast } from '../../stores/toast.store';

const attendanceRulesSchema = z.object({
  csat_enabled: z.boolean().default(true),
  csat_message: z.string().max(2000).optional(),
  csat_expiration_hours: z.number().int().min(1).max(720).default(48),
  email_confirmation: z.boolean().default(true),
  inactivity_enabled: z.boolean().default(true),
  inactivity_warning_minutes: z.number().int().min(1).max(1440),
  inactivity_close_minutes: z.number().int().min(1).max(1440),
  inactivity_warning_message: z.string().max(2000).optional(),
  inactivity_close_message: z.string().max(2000).optional(),
  active_outbound_validity_mode: z.enum(['until_end_of_day', 'hours', 'unlimited']).default('until_end_of_day'),
  active_outbound_validity_hours: z.number().int().min(1).max(168).optional(),
  bot_assigned_message: z.string().max(1000).optional(),
  max_conversations_per_agent: z.number().int().min(1).max(500).nullable().optional(),
});

type AttendanceRulesForm = z.infer<typeof attendanceRulesSchema>;

function mapBackendModeToFormMode(value: string | undefined): AttendanceRulesForm['active_outbound_validity_mode'] {
  if (value === 'hours') return 'hours';
  return 'until_end_of_day';
}

export function AttendanceRules() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const defaultInactivityWarning = t('settings.defaultInactivityWarning');
  const defaultInactivityClose = t('settings.defaultInactivityClose');
  const defaultBotAssignedMessage = t('settings.defaultBotAssignedMessage');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<AttendanceRulesForm>({
    resolver: zodResolver(attendanceRulesSchema),
    defaultValues: {
      csat_enabled: true,
      csat_message: '',
      csat_expiration_hours: 48,
      email_confirmation: true,
      inactivity_enabled: true,
      inactivity_warning_minutes: 30,
      inactivity_close_minutes: 60,
      inactivity_warning_message: defaultInactivityWarning,
      inactivity_close_message: defaultInactivityClose,
      active_outbound_validity_mode: 'until_end_of_day',
      active_outbound_validity_hours: 24,
      bot_assigned_message: defaultBotAssignedMessage,
      max_conversations_per_agent: null,
    },
  });

  useEffect(() => {
    if (!data) return;
    reset({
      csat_enabled: data.csat_enabled ?? true,
      csat_message: data.csat_message ?? '',
      csat_expiration_hours: data.csat_expiration_hours ?? 48,
      email_confirmation: data.email_confirmation ?? true,
      inactivity_enabled: data.inactivity_enabled ?? true,
      inactivity_warning_minutes: data.inactivity_warning_minutes ?? 30,
      inactivity_close_minutes: data.inactivity_close_minutes ?? 60,
      inactivity_warning_message: data.inactivity_warning_message ?? defaultInactivityWarning,
      inactivity_close_message: data.inactivity_close_message ?? defaultInactivityClose,
      active_outbound_validity_mode: mapBackendModeToFormMode(data.active_outbound_validity_mode),
      active_outbound_validity_hours: data.active_outbound_validity_hours ?? 24,
      bot_assigned_message: data.bot_assigned_message ?? defaultBotAssignedMessage,
      max_conversations_per_agent: data.max_conversations_per_agent ?? null,
    });
  }, [data, defaultBotAssignedMessage, defaultInactivityClose, defaultInactivityWarning, reset]);

  const mutation = useMutation({
    mutationFn: (values: AttendanceRulesForm) => {
      const normalizedMode = values.active_outbound_validity_mode === 'hours' ? 'hours' : 'end_of_day';
      return adminApi.updateSettings({
        csat_enabled: values.csat_enabled,
        csat_message: values.csat_message ?? null,
        csat_expiration_hours: values.csat_expiration_hours,
        email_confirmation: values.email_confirmation,
        inactivity_enabled: values.inactivity_enabled,
        inactivity_warning_minutes: values.inactivity_warning_minutes,
        inactivity_close_minutes: values.inactivity_close_minutes,
        inactivity_warning_message: values.inactivity_warning_message ?? '',
        inactivity_close_message: values.inactivity_close_message ?? '',
        active_outbound_validity_mode: normalizedMode,
        ...(values.active_outbound_validity_mode === 'hours'
          ? { active_outbound_validity_hours: values.active_outbound_validity_hours ?? 24 }
          : {}),
        bot_assigned_message: values.bot_assigned_message ?? '',
        max_conversations_per_agent: values.max_conversations_per_agent ?? null,
      });
    },
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success(t('attendanceRules.saveSuccess'));
    },
    onError: () => {
      toast.error(t('attendanceRules.saveError'));
    },
  });

  const inactivityEnabled = watch('inactivity_enabled');
  const csatEnabled = watch('csat_enabled');
  const activeOutboundMode = watch('active_outbound_validity_mode');
  const portalAddress = `suporte@${data?.slug ?? 'demo'}.ziradesk.com.br`;

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-3)',
    border: '1px solid var(--line-2)',
    color: 'var(--txt)',
    height: 40,
    borderRadius: 'var(--r)',
    padding: '0 0.75rem',
    fontSize: 13,
    width: '100%',
    outline: 'none',
    fontFamily: 'var(--font)',
  };

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl" style={{ color: 'var(--txt)', fontWeight: 600 }}>
            {t('attendanceRules.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('attendanceRules.subtitle')}
          </p>
        </div>

        <div
          className="rounded-xl"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
        >
          {isLoading ? (
            <div className="space-y-4 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-3" />
              ))}
            </div>
          ) : (
            <form
              onSubmit={handleSubmit((values) => {
                if (values.inactivity_close_minutes <= values.inactivity_warning_minutes) {
                  toast.error(t('attendanceRules.inactivityValidation'));
                  return;
                }
                mutation.mutate(values);
              })}
              style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              <div className="space-y-5 p-6">
                <section
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '0.75rem',
                    padding: '0.85rem 0.9rem',
                    background: 'var(--bg-3)',
                    display: 'grid',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)' }}>
                    {t('attendanceRules.sections.csat')}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--txt-3)', margin: 0 }}>
                    {t('attendanceRules.csatScopeHint')}
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--txt)', fontWeight: 600 }}>
                      {t('attendanceRules.csatEnabled')}
                    </span>
                    <input
                      type="checkbox"
                      {...register('csat_enabled')}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
                    />
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                      {t('attendanceRules.csatMessage')}
                    </label>
                    <textarea
                      rows={4}
                      placeholder={t('attendanceRules.csatMessagePlaceholder')}
                      disabled={!csatEnabled}
                      {...register('csat_message')}
                      style={{
                        width: '100%',
                        background: 'var(--bg-2)',
                        border: '1px solid var(--line)',
                        color: 'var(--txt)',
                        borderRadius: '0.5rem',
                        padding: '0.75rem',
                        fontSize: '0.875rem',
                        fontFamily: 'var(--font)',
                        resize: 'vertical',
                        outline: 'none',
                        opacity: csatEnabled ? 1 : 0.55,
                      }}
                    />
                    <p className="text-xs" style={{ color: 'var(--txt-3)', margin: 0 }}>
                      {csatEnabled
                        ? t('attendanceRules.csatMessageHint')
                        : t('attendanceRules.csatDisabledHint')}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    label={t('attendanceRules.csatExpiration')}
                    disabled={!csatEnabled}
                    error={errors.csat_expiration_hours?.message}
                    {...register('csat_expiration_hours', { valueAsNumber: true })}
                  />
                </section>

                <section
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '0.75rem',
                    padding: '0.85rem 0.9rem',
                    background: 'var(--bg-3)',
                    display: 'grid',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)' }}>
                    {t('attendanceRules.sections.email')}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                      {t('attendanceRules.emailAddress')}
                    </label>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: 8,
                        borderRadius: 'var(--r)',
                        border: '1px solid var(--line-2)',
                        background: 'var(--bg-2)',
                      }}
                    >
                      <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt)' }}>
                        {portalAddress}
                      </code>
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--txt)', fontWeight: 600 }}>
                      {t('attendanceRules.emailConfirmation')}
                    </span>
                    <input
                      type="checkbox"
                      {...register('email_confirmation')}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
                    />
                  </label>
                </section>

                <section
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '0.75rem',
                    padding: '0.85rem 0.9rem',
                    background: 'var(--bg-3)',
                    display: 'grid',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)' }}>
                    {t('attendanceRules.sections.inactivity')}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--txt)', fontWeight: 600 }}>
                      {t('attendanceRules.inactivityEnabled')}
                    </span>
                    <input
                      type="checkbox"
                      {...register('inactivity_enabled')}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
                    />
                  </label>

                  {inactivityEnabled && (
                    <>
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        label={t('attendanceRules.inactivityWarning')}
                        error={errors.inactivity_warning_minutes?.message}
                        {...register('inactivity_warning_minutes', { valueAsNumber: true })}
                      />
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        label={t('attendanceRules.inactivityClose')}
                        error={errors.inactivity_close_minutes?.message}
                        {...register('inactivity_close_minutes', { valueAsNumber: true })}
                      />
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                          {t('attendanceRules.inactivityWarningMessage')}
                        </label>
                        <textarea
                          rows={3}
                          {...register('inactivity_warning_message')}
                          style={{
                            width: '100%',
                            background: 'var(--bg-2)',
                            border: '1px solid var(--line)',
                            color: 'var(--txt)',
                            borderRadius: '0.5rem',
                            padding: '0.75rem',
                            fontSize: '0.875rem',
                            fontFamily: 'var(--font)',
                            resize: 'vertical',
                            outline: 'none',
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                          {t('attendanceRules.inactivityCloseMessage')}
                        </label>
                        <textarea
                          rows={3}
                          {...register('inactivity_close_message')}
                          style={{
                            width: '100%',
                            background: 'var(--bg-2)',
                            border: '1px solid var(--line)',
                            color: 'var(--txt)',
                            borderRadius: '0.5rem',
                            padding: '0.75rem',
                            fontSize: '0.875rem',
                            fontFamily: 'var(--font)',
                            resize: 'vertical',
                            outline: 'none',
                          }}
                        />
                      </div>
                    </>
                  )}
                </section>

                <section
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '0.75rem',
                    padding: '0.85rem 0.9rem',
                    background: 'var(--bg-3)',
                    display: 'grid',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)' }}>
                    {t('attendanceRules.sections.outbound')}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                      {t('attendanceRules.outboundMode')}
                    </label>
                    <select
                      style={selectStyle}
                      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
                      {...register('active_outbound_validity_mode')}
                    >
                      <option value="until_end_of_day">{t('attendanceRules.outboundModes.until_end_of_day')}</option>
                      <option value="hours">{t('attendanceRules.outboundModes.hours')}</option>
                      <option value="unlimited">{t('attendanceRules.outboundModes.unlimited')}</option>
                    </select>
                  </div>
                  {activeOutboundMode === 'hours' && (
                    <Input
                      type="number"
                      min={1}
                      max={168}
                      label={t('attendanceRules.outboundHours')}
                      error={errors.active_outbound_validity_hours?.message}
                      {...register('active_outbound_validity_hours', { valueAsNumber: true })}
                    />
                  )}
                </section>

                <section
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '0.75rem',
                    padding: '0.85rem 0.9rem',
                    background: 'var(--bg-3)',
                    display: 'grid',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)' }}>
                    {t('attendanceRules.sections.bot')}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                      {t('attendanceRules.botAssignedMessage')}
                    </label>
                    <textarea
                      rows={4}
                      placeholder={t('attendanceRules.botAssignedHint')}
                      {...register('bot_assigned_message')}
                      style={{
                        width: '100%',
                        background: 'var(--bg-2)',
                        border: '1px solid var(--line)',
                        color: 'var(--txt)',
                        borderRadius: '0.5rem',
                        padding: '0.75rem',
                        fontSize: '0.875rem',
                        fontFamily: 'var(--font)',
                        resize: 'vertical',
                        outline: 'none',
                      }}
                    />
                    <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
                      {t('attendanceRules.botAssignedHint')}
                    </p>
                  </div>
                </section>

                <section
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '0.75rem',
                    padding: '0.85rem 0.9rem',
                    background: 'var(--bg-3)',
                    display: 'grid',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)' }}>
                    {t('attendanceRules.sections.limits')}
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    label={t('attendanceRules.maxConversations')}
                    placeholder={t('attendanceRules.maxConversationsHint')}
                    error={errors.max_conversations_per_agent?.message}
                    {...register('max_conversations_per_agent', {
                      setValueAs: (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
                    })}
                  />
                  <p className="text-xs -mt-3" style={{ color: 'var(--txt-3)' }}>
                    {t('attendanceRules.maxConversationsHint')}
                  </p>
                </section>
              </div>

              <div
                style={{
                  borderTop: '1px solid var(--line)',
                  padding: '12px 24px',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  background: 'var(--bg-2)',
                }}
              >
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.settings.saveSettings')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </PageShell>
  );
}
