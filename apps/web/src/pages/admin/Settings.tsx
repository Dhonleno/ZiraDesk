import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { adminApi } from '../../services/api';
import i18n from '@/i18n';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { PageShell } from '../../components/layout/PageShell';
import { useToast } from '../../stores/toast.store';

const settingsSchema = z.object({
  name: z.string().min(1),
  language: z.enum(['pt-BR', 'en-US', 'es']),
  timezone: z.string().min(1),
  csat_enabled: z.boolean().default(true),
  csat_message: z.string().max(2000).optional(),
  csat_expiration_hours: z.number().int().min(1).max(720).default(48),
  email_confirmation: z.boolean().default(true),
  inactivity_enabled: z.boolean().default(true),
  inactivity_warning_minutes: z.number().int().min(1).max(1440),
  inactivity_close_minutes: z.number().int().min(1).max(1440),
  inactivity_warning_message: z.string().max(2000).optional(),
  inactivity_close_message: z.string().max(2000).optional(),
  active_outbound_validity_mode: z.enum(['end_of_day', 'hours']).default('end_of_day'),
  active_outbound_validity_hours: z.number().int().min(1).max(168),
  bot_assigned_message: z.string().max(1000).optional(),
  max_conversations_per_agent: z.number().int().min(1).max(500).nullable().optional(),
});

type SettingsForm = z.infer<typeof settingsSchema>;

function normalizeLanguage(value: string | undefined): SettingsForm['language'] {
  if (!value) return 'pt-BR';
  if (value === 'pt-BR' || value.toLowerCase().startsWith('pt')) return 'pt-BR';
  if (value === 'en-US' || value.toLowerCase().startsWith('en')) return 'en-US';
  if (value === 'es' || value.toLowerCase().startsWith('es')) return 'es';
  return 'pt-BR';
}

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Noronha',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'UTC',
];

export function Settings() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const languages = [
    { value: 'pt-BR', label: t('settings.languages.ptBR') },
    { value: 'en-US', label: t('settings.languages.enUS') },
    { value: 'es', label: t('settings.languages.es') },
  ] as const;
  const currentLang = normalizeLanguage(i18n.language);
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
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: '',
      language: currentLang,
      timezone: 'America/Sao_Paulo',
      csat_enabled: true,
      csat_message: '',
      csat_expiration_hours: 48,
      inactivity_enabled: true,
      inactivity_warning_minutes: 30,
      inactivity_close_minutes: 60,
      inactivity_warning_message: defaultInactivityWarning,
      inactivity_close_message: defaultInactivityClose,
      active_outbound_validity_mode: 'end_of_day',
      active_outbound_validity_hours: 24,
      bot_assigned_message: defaultBotAssignedMessage,
    },
  });

  useEffect(() => {
    if (data) {
      reset({
        name: data.name,
        language: currentLang,
        timezone: data.timezone ?? 'America/Sao_Paulo',
        csat_enabled: data.csat_enabled ?? true,
        csat_message: data.csat_message ?? '',
        csat_expiration_hours: data.csat_expiration_hours ?? 48,
        email_confirmation: data.email_confirmation ?? true,
        inactivity_enabled: data.inactivity_enabled ?? true,
        inactivity_warning_minutes: data.inactivity_warning_minutes ?? 30,
        inactivity_close_minutes: data.inactivity_close_minutes ?? 60,
        inactivity_warning_message:
          data.inactivity_warning_message
          ?? defaultInactivityWarning,
        inactivity_close_message:
          data.inactivity_close_message
          ?? defaultInactivityClose,
        active_outbound_validity_mode:
          (data.active_outbound_validity_mode as SettingsForm['active_outbound_validity_mode']) ?? 'end_of_day',
        active_outbound_validity_hours: data.active_outbound_validity_hours ?? 24,
        bot_assigned_message: data.bot_assigned_message ?? defaultBotAssignedMessage,
        max_conversations_per_agent: data.max_conversations_per_agent ?? null,
      });
    }
  }, [
    currentLang,
    data,
    defaultBotAssignedMessage,
    defaultInactivityClose,
    defaultInactivityWarning,
    reset,
  ]);

  const mutation = useMutation({
    mutationFn: (values: SettingsForm) =>
      adminApi.updateSettings({
        ...values,
        csat_message: values.csat_message ?? null,
        email_confirmation: values.email_confirmation ?? true,
        inactivity_warning_message: values.inactivity_warning_message ?? '',
        inactivity_close_message: values.inactivity_close_message ?? '',
        active_outbound_validity_mode: values.active_outbound_validity_mode,
        active_outbound_validity_hours: values.active_outbound_validity_hours,
        bot_assigned_message: values.bot_assigned_message ?? '',
        max_conversations_per_agent: values.max_conversations_per_agent ?? null,
      }),
    onSuccess: async (_, values) => {
      const nextLanguage = normalizeLanguage(values.language);
      await i18n.changeLanguage(nextLanguage);
      localStorage.setItem('i18nextLng', nextLanguage);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success(t('tenantAdmin.settings.messages.saved'));
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: (file: File) => adminApi.uploadSettingsLogo(file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success(t('settings.logoUpdated'));
    },
    onError: () => toast.error(t('settings.logoUploadError')),
  });

  const removeLogoMutation = useMutation({
    mutationFn: () => adminApi.updateSettings({ logo_url: null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success(t('settings.logoRemoved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const handleLogoUpload = (file?: File | null) => {
    if (!file) return;
    const accepted = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!accepted.includes(file.type)) {
      toast.error(t('settings.invalidImageFormat'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('settings.imageMaxSize'));
      return;
    }
    uploadLogoMutation.mutate(file);
  };

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
  const inactivityEnabled = watch('inactivity_enabled');
  const activeOutboundValidityMode = watch('active_outbound_validity_mode');
  const portalAddress = `suporte@${data?.slug ?? 'demo'}.ziradesk.com.br`;

  const copySupportAddress = async () => {
    try {
      await navigator.clipboard.writeText(portalAddress);
      toast.success(t('settings.addressCopied'));
    } catch {
      toast.error(t('settings.addressCopyError'));
    }
  };

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
          <div>
            <h1 className="text-2xl" style={{ color: 'var(--txt)', fontWeight: 600 }}>
          {t('tenantAdmin.settings.title')}
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
              {t('tenantAdmin.settings.subtitle')}
            </p>
          </div>

          <div
            className="rounded-xl"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
          >
            {isLoading ? (
              <div className="space-y-4 p-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-3" />
                ))}
              </div>
            ) : (
              <form
                onSubmit={handleSubmit((v) => {
                  if (v.inactivity_close_minutes <= v.inactivity_warning_minutes) {
                    toast.error(t('tenantAdmin.settings.inactivity.validation.closeGreaterThanWarning'));
                    return;
                  }
                  mutation.mutate(v);
                })}
                style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
              >
                <div className="space-y-5 p-6">
                  <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '0.75rem',
                padding: '0.85rem 0.9rem',
                background: 'var(--bg-3)',
              }}
            >
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)', marginBottom: 10 }}>
                      {t('settings.visualIdentity')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 12,
                    border: '1px solid var(--line)',
                    background: 'var(--bg-2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                      >
                        {data?.logo_url ? (
                          <img
                            src={data.logo_url}
                            alt={t('settings.logoAlt')}
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          />
                        ) : (
                          <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--txt-3)' }}>Z</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                        <label
                    htmlFor="logo-input"
                    style={{
                      width: 'fit-content',
                      padding: '6px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--line-2)',
                      background: 'var(--bg-4)',
                      color: 'var(--txt-2)',
                      fontSize: 12,
                      cursor: uploadLogoMutation.isPending ? 'wait' : 'pointer',
                    }}
                        >
                          {uploadLogoMutation.isPending ? t('settings.uploadingImage') : t('settings.chooseImage')}
                        </label>
                        <input
                    id="logo-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(event) => handleLogoUpload(event.target.files?.[0] ?? null)}
                    style={{ display: 'none' }}
                        />

                        {data?.logo_url && (
                          <button
                      type="button"
                      onClick={() => removeLogoMutation.mutate()}
                      disabled={removeLogoMutation.isPending}
                      style={{
                        width: 'fit-content',
                        border: 'none',
                        background: 'none',
                        color: 'var(--red)',
                        fontSize: 12,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                          >
                            {removeLogoMutation.isPending ? t('settings.removingImage') : t('settings.removeImage')}
                          </button>
                        )}

                        <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                          {t('settings.imageHint')}
                        </span>
                      </div>
                    </div>
                </div>

                <Input
              label={t('tenantAdmin.settings.fields.name')}
              error={errors.name?.message}
              {...register('name')}
                />

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                {t('tenantAdmin.settings.fields.language')}
              </label>
              <select
                style={selectStyle}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
                {...register('language')}
              >
                {languages.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                {t('tenantAdmin.settings.fields.timezone')}
              </label>
              <select
                style={selectStyle}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
                {...register('timezone')}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '0.75rem',
                padding: '0.85rem 0.9rem',
                background: 'var(--bg-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.875rem', color: 'var(--txt)', fontWeight: 600 }}>
                  {t('tenantAdmin.settings.csat.enabled')}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--txt-3)', marginTop: 2 }}>
                  {t('tenantAdmin.settings.csat.enabledHint')}
                </div>
              </div>
              <input
                type="checkbox"
                {...register('csat_enabled')}
                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
              />
            </div>

            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '0.75rem',
                padding: '0.85rem 0.9rem',
                background: 'var(--bg-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ fontSize: '0.875rem', color: 'var(--txt)', fontWeight: 600 }}>
                {t('tenantAdmin.settings.emailInbound.title')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t('tenantAdmin.settings.emailInbound.address')}
                </span>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: 8,
                    borderRadius: 'var(--r)',
                    border: '1px solid var(--line-2)',
                    background: 'var(--bg-2)',
                  }}
                >
                  <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt)', flex: 1, overflowX: 'auto' }}>
                    {portalAddress}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copySupportAddress()}
                    className="zd-btn"
                    style={{ flexShrink: 0 }}
                  >
                    {t('tenantAdmin.common.copy')}
                  </button>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--txt-3)' }}>
                  {t('tenantAdmin.settings.emailInbound.hint')}
                </span>
              </div>

              <div
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: '0.75rem',
                  padding: '0.85rem 0.9rem',
                  background: 'var(--bg-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                }}
              >
                <div style={{ fontSize: '0.875rem', color: 'var(--txt)', fontWeight: 600 }}>
                  {t('tenantAdmin.settings.emailInbound.confirmation')}
                </div>
                <input
                  type="checkbox"
                  {...register('email_confirmation')}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                {t('tenantAdmin.settings.csat.message')}
              </label>
              <textarea
                rows={6}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
                {...register('csat_message')}
                placeholder={t('tenantAdmin.settings.csat.messagePlaceholder')}
                style={{
                  width: '100%',
                  background: 'var(--bg-3)',
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

            <Input
              type="number"
              label={t('tenantAdmin.settings.csat.expirationHours')}
              min={1}
              max={720}
              error={errors.csat_expiration_hours?.message}
              {...register('csat_expiration_hours', { valueAsNumber: true })}
            />
            <p className="text-xs -mt-3" style={{ color: 'var(--txt-3)' }}>
              {t('tenantAdmin.settings.csat.expirationHint')}
            </p>

            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '0.75rem',
                padding: '0.85rem 0.9rem',
                background: 'var(--bg-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.875rem', color: 'var(--txt)', fontWeight: 600 }}>
                  {t('tenantAdmin.settings.inactivity.enabled')}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--txt-3)', marginTop: 2 }}>
                  {t('tenantAdmin.settings.inactivity.enabledHint')}
                </div>
              </div>
              <input
                type="checkbox"
                {...register('inactivity_enabled')}
                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
              />
            </div>

            {inactivityEnabled && (
              <>
                <Input
                  type="number"
                  label={t('tenantAdmin.settings.inactivity.warningMinutes')}
                  min={1}
                  max={1440}
                  error={errors.inactivity_warning_minutes?.message}
                  {...register('inactivity_warning_minutes', { valueAsNumber: true })}
                />

                <Input
                  type="number"
                  label={t('tenantAdmin.settings.inactivity.closeMinutes')}
                  min={1}
                  max={1440}
                  error={errors.inactivity_close_minutes?.message}
                  {...register('inactivity_close_minutes', { valueAsNumber: true })}
                />
                <p className="text-xs -mt-3" style={{ color: 'var(--txt-3)' }}>
                  {t('tenantAdmin.settings.inactivity.closeHint')}
                </p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                    {t('tenantAdmin.settings.inactivity.warningMessage')}
                  </label>
                  <textarea
                    rows={3}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
                    {...register('inactivity_warning_message')}
                    placeholder={t('tenantAdmin.settings.inactivity.warningMessageHint')}
                    style={{
                      width: '100%',
                      background: 'var(--bg-3)',
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
                    {t('tenantAdmin.settings.inactivity.closeMessage')}
                  </label>
                  <textarea
                    rows={3}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
                    {...register('inactivity_close_message')}
                    style={{
                      width: '100%',
                      background: 'var(--bg-3)',
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

            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '0.75rem',
                padding: '0.85rem 0.9rem',
                background: 'var(--bg-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ fontSize: '0.875rem', color: 'var(--txt)', fontWeight: 600 }}>
                {t('tenantAdmin.settings.activeOutbound.title')}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--txt-3)' }}>
                {t('tenantAdmin.settings.activeOutbound.hint')}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                  {t('tenantAdmin.settings.activeOutbound.validityMode')}
                </label>
                <select
                  style={selectStyle}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
                  {...register('active_outbound_validity_mode')}
                >
                  <option value="end_of_day">{t('tenantAdmin.settings.activeOutbound.mode.endOfDay')}</option>
                  <option value="hours">{t('tenantAdmin.settings.activeOutbound.mode.hours')}</option>
                </select>
              </div>

              {activeOutboundValidityMode === 'hours' && (
                <Input
                  type="number"
                  label={t('tenantAdmin.settings.activeOutbound.validityHours')}
                  min={1}
                  max={168}
                  error={errors.active_outbound_validity_hours?.message}
                  {...register('active_outbound_validity_hours', { valueAsNumber: true })}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                {t('tenantAdmin.settings.bot.assignedMessage')}
              </label>
              <textarea
                rows={4}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-0"
                {...register('bot_assigned_message')}
                placeholder="{{agent}}"
                style={{
                  width: '100%',
                  background: 'var(--bg-3)',
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
                {t('tenantAdmin.settings.bot.assignedMessageHint')}
              </p>
            </div>

            <Input
              type="number"
              label={t('tenantAdmin.settings.maxConversations')}
              min={1}
              max={500}
              placeholder={t('tenantAdmin.settings.maxConversationsDesc')}
              error={errors.max_conversations_per_agent?.message}
              {...register('max_conversations_per_agent', {
                setValueAs: (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
              })}
            />
            <p className="text-xs -mt-3" style={{ color: 'var(--txt-3)' }}>
              {t('tenantAdmin.settings.maxConversationsDesc')}
            </p>

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
