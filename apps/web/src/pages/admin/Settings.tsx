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

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: '',
      language: currentLang,
      timezone: 'America/Sao_Paulo',
    },
  });

  useEffect(() => {
    if (!data) return;
    reset({
      name: data.name,
      language: normalizeLanguage(data.language),
      timezone: data.timezone ?? 'America/Sao_Paulo',
    });
  }, [data, reset]);

  const mutation = useMutation({
    mutationFn: (values: SettingsForm) =>
      adminApi.updateSettings({
        name: values.name,
        language: values.language,
        timezone: values.timezone,
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
              onSubmit={handleSubmit((v) => mutation.mutate(v))}
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
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--txt-3)',
                      marginBottom: 10,
                    }}
                  >
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
