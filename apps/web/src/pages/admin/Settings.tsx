import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { adminApi } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../stores/toast.store';

const settingsSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  language: z.enum(['pt-BR', 'en-US', 'es']),
  timezone: z.string().min(1),
  csat_enabled: z.boolean().default(true),
  csat_message: z.string().max(2000).optional(),
  inactivity_enabled: z.boolean().default(true),
  inactivity_warning_minutes: z.number().int().min(1).max(1440),
  inactivity_close_minutes: z.number().int().min(1).max(1440),
  inactivity_warning_message: z.string().max(2000).optional(),
  inactivity_close_message: z.string().max(2000).optional(),
  bot_assigned_message: z.string().max(1000).optional(),
});

type SettingsForm = z.infer<typeof settingsSchema>;

const LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'es', label: 'Español' },
];

const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'America/São_Paulo (GMT-3)' },
  { value: 'America/Manaus', label: 'America/Manaus (GMT-4)' },
  { value: 'America/Belem', label: 'America/Belém (GMT-3)' },
  { value: 'America/Fortaleza', label: 'America/Fortaleza (GMT-3)' },
  { value: 'America/Recife', label: 'America/Recife (GMT-3)' },
  { value: 'America/Noronha', label: 'America/Noronha (GMT-2)' },
  { value: 'America/New_York', label: 'America/New_York (GMT-5/-4)' },
  { value: 'America/Chicago', label: 'America/Chicago (GMT-6/-5)' },
  { value: 'America/Denver', label: 'America/Denver (GMT-7/-6)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (GMT-8/-7)' },
  { value: 'Europe/London', label: 'Europe/London (GMT+0/+1)' },
  { value: 'Europe/Lisbon', label: 'Europe/Lisbon (GMT+0/+1)' },
  { value: 'Europe/Madrid', label: 'Europe/Madrid (GMT+1/+2)' },
  { value: 'UTC', label: 'UTC' },
];

function SettingsCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <span className="settings-card-icon">{icon}</span>
        <span className="settings-card-title">{title}</span>
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-toggle-row">
      <div>
        <div className="settings-toggle-label">{label}</div>
        <div className="settings-toggle-desc">{description}</div>
      </div>
      {children}
    </div>
  );
}

export function Settings() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: '',
      language: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      csat_enabled: true,
      csat_message: '',
      inactivity_enabled: true,
      inactivity_warning_minutes: 30,
      inactivity_close_minutes: 60,
      inactivity_warning_message:
        'Olá! Notamos que você está inativo há {{time}}. Seu atendimento será encerrado em {{remaining}} minutos caso não haja interação.',
      inactivity_close_message:
        'Seu atendimento foi encerrado por inatividade. Caso precise de ajuda, entre em contato novamente. 😊',
      bot_assigned_message: [
        '✅ Seu atendimento foi aceito!',
        '',
        'Você está sendo atendido por *{{agent}}*.',
        'Em breve entraremos em contato. 😊',
      ].join('\n'),
    },
  });

  useEffect(() => {
    if (!data) return;
    reset({
      name: data.name,
      language: (data.language as SettingsForm['language']) ?? 'pt-BR',
      timezone: data.timezone ?? 'America/Sao_Paulo',
      csat_enabled: data.csat_enabled ?? true,
      csat_message: data.csat_message ?? '',
      inactivity_enabled: data.inactivity_enabled ?? true,
      inactivity_warning_minutes: data.inactivity_warning_minutes ?? 30,
      inactivity_close_minutes: data.inactivity_close_minutes ?? 60,
      inactivity_warning_message:
        data.inactivity_warning_message
        ?? 'Olá! Notamos que você está inativo há {{time}}. Seu atendimento será encerrado em {{remaining}} minutos caso não haja interação.',
      inactivity_close_message:
        data.inactivity_close_message
        ?? 'Seu atendimento foi encerrado por inatividade. Caso precise de ajuda, entre em contato novamente. 😊',
      bot_assigned_message: data.bot_assigned_message ?? [
        '✅ Seu atendimento foi aceito!',
        '',
        'Você está sendo atendido por *{{agent}}*.',
        'Em breve entraremos em contato. 😊',
      ].join('\n'),
    });
  }, [data, reset]);

  const mutation = useMutation({
    mutationFn: (values: SettingsForm) =>
      adminApi.updateSettings({
        ...values,
        csat_message: values.csat_message ?? null,
        inactivity_warning_message: values.inactivity_warning_message ?? '',
        inactivity_close_message: values.inactivity_close_message ?? '',
        bot_assigned_message: values.bot_assigned_message ?? '',
      }),
    onSuccess: () => {
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
      toast.success('Logo atualizada com sucesso');
    },
    onError: () => toast.error('Erro ao enviar logo'),
  });

  const removeLogoMutation = useMutation({
    mutationFn: () => adminApi.updateSettings({ logo_url: null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success('Logo removida');
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const handleLogoUpload = (file?: File | null) => {
    if (!file) return;
    const accepted = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!accepted.includes(file.type)) {
      toast.error('Formato inválido. Use PNG, JPG, WEBP ou SVG.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 2MB.');
      return;
    }
    uploadLogoMutation.mutate(file);
  };

  const inactivityEnabled = watch('inactivity_enabled');
  const csatEnabled = watch('csat_enabled');

  return (
    <div className="admin-page settings-page">
      <div className="settings-header">
        <h1>{t('tenantAdmin.settings.title')}</h1>
        <p>{t('tenantAdmin.settings.subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="settings-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="settings-card" style={{ height: 200, opacity: 0.5 }} />
          ))}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit((values) => {
            if (values.inactivity_close_minutes <= values.inactivity_warning_minutes) {
              toast.error(t('tenantAdmin.settings.inactivity.validation.closeGreaterThanWarning'));
              return;
            }
            mutation.mutate(values);
          })}
          className="settings-page"
        >
          <div className="settings-grid">
            <div className="settings-col">
              <SettingsCard title="Identidade Visual" icon="🎨">
                <div className="logo-section">
                  <div className="logo-preview">
                    {data?.logo_url ? (
                      <img src={data.logo_url} alt="Logo" />
                    ) : (
                      <span className="logo-placeholder">Z</span>
                    )}
                  </div>
                  <div className="logo-info">
                    <label
                      htmlFor="logo-input"
                      style={{
                        width: 'fit-content',
                        padding: '6px 10px',
                        borderRadius: 'var(--r)',
                        border: '1px solid var(--line-2)',
                        background: 'var(--bg-4)',
                        color: 'var(--txt-2)',
                        fontSize: 12,
                        cursor: uploadLogoMutation.isPending ? 'wait' : 'pointer',
                      }}
                    >
                      {uploadLogoMutation.isPending ? 'Enviando...' : 'Escolher imagem'}
                    </label>
                    <input
                      id="logo-input"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={(event) => handleLogoUpload(event.target.files?.[0] ?? null)}
                      style={{ display: 'none' }}
                    />
                    <span className="field-hint">PNG, JPG, WEBP ou SVG. Máximo 2MB.</span>
                    {data?.logo_url ? (
                      <button
                        type="button"
                        onClick={() => removeLogoMutation.mutate()}
                        style={{
                          width: 'fit-content',
                          color: 'var(--red)',
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 12,
                        }}
                      >
                        {removeLogoMutation.isPending ? 'Removendo...' : 'Remover logo'}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="settings-field">
                  <label>{t('tenantAdmin.settings.fields.name')}</label>
                  <input className="settings-input" {...register('name')} />
                  {errors.name?.message ? (
                    <span className="field-hint" style={{ color: 'var(--red)' }}>{errors.name.message}</span>
                  ) : null}
                </div>
              </SettingsCard>

              <SettingsCard title="Localização e Idioma" icon="🌐">
                <div className="form-row-2">
                  <div className="settings-field">
                    <label>{t('tenantAdmin.settings.fields.language')}</label>
                    <select className="settings-select" {...register('language')}>
                      {LANGUAGES.map((language) => (
                        <option key={language.value} value={language.value}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-field">
                    <label>{t('tenantAdmin.settings.fields.timezone')}</label>
                    <select className="settings-select" {...register('timezone')}>
                      {TIMEZONES.map((timezone) => (
                        <option key={timezone.value} value={timezone.value}>
                          {timezone.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </SettingsCard>
            </div>

            <div className="settings-col">
              <SettingsCard title="Pesquisa de Satisfação (CSAT)" icon="⭐">
                <ToggleRow
                  label={t('tenantAdmin.settings.csat.enabled')}
                  description={t('tenantAdmin.settings.csat.enabledHint')}
                >
                  <input
                    type="checkbox"
                    {...register('csat_enabled')}
                    style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
                  />
                </ToggleRow>

                {csatEnabled ? (
                  <div className="settings-field">
                    <label>{t('tenantAdmin.settings.csat.message')}</label>
                    <textarea
                      className="settings-textarea"
                      rows={3}
                      {...register('csat_message')}
                      placeholder={t('tenantAdmin.settings.csat.messagePlaceholder')}
                    />
                  </div>
                ) : null}
              </SettingsCard>

              <SettingsCard title={t('tenantAdmin.settings.inactivity.title')} icon="⏱️">
                <ToggleRow
                  label={t('tenantAdmin.settings.inactivity.enabled')}
                  description={t('tenantAdmin.settings.inactivity.enabledHint')}
                >
                  <input
                    type="checkbox"
                    {...register('inactivity_enabled')}
                    style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
                  />
                </ToggleRow>

                {inactivityEnabled ? (
                  <>
                    <div className="form-row-2">
                      <div className="settings-field">
                        <label>{t('tenantAdmin.settings.inactivity.warningMinutes')}</label>
                        <input
                          className="settings-input"
                          type="number"
                          min={5}
                          max={120}
                          {...register('inactivity_warning_minutes', { valueAsNumber: true })}
                        />
                        <span className="field-hint">{t('tenantAdmin.settings.inactivity.warningHint')}</span>
                      </div>
                      <div className="settings-field">
                        <label>{t('tenantAdmin.settings.inactivity.closeMinutes')}</label>
                        <input
                          className="settings-input"
                          type="number"
                          min={10}
                          max={480}
                          {...register('inactivity_close_minutes', { valueAsNumber: true })}
                        />
                        <span className="field-hint">{t('tenantAdmin.settings.inactivity.closeHint')}</span>
                      </div>
                    </div>

                    <div className="settings-field">
                      <label>{t('tenantAdmin.settings.inactivity.warningMessage')}</label>
                      <textarea
                        className="settings-textarea"
                        rows={2}
                        {...register('inactivity_warning_message')}
                      />
                      <span className="field-hint">{t('tenantAdmin.settings.inactivity.warningMessageHint')}</span>
                    </div>

                    <div className="settings-field">
                      <label>{t('tenantAdmin.settings.inactivity.closeMessage')}</label>
                      <textarea
                        className="settings-textarea"
                        rows={2}
                        {...register('inactivity_close_message')}
                      />
                    </div>
                  </>
                ) : null}
              </SettingsCard>

              <SettingsCard title="Bot de Atendimento" icon="🤖">
                <div className="settings-field">
                  <label>{t('tenantAdmin.settings.bot.assignedMessage')}</label>
                  <textarea
                    className="settings-textarea"
                    rows={4}
                    {...register('bot_assigned_message')}
                  />
                  <span className="field-hint">{t('tenantAdmin.settings.bot.assignedMessageHint')}</span>
                </div>
              </SettingsCard>
            </div>
          </div>

          <div className="settings-footer">
            <Button type="submit" disabled={mutation.isPending || !isDirty}>
              {mutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.settings.saveSettings')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
