import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { adminApi } from '../../services/api';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../stores/toast.store';

const settingsSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  language: z.enum(['pt-BR', 'en-US', 'es']),
  timezone: z.string().min(1),
});

type SettingsForm = z.infer<typeof settingsSchema>;

const LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'es', label: 'Español' },
];

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
    defaultValues: { name: '', language: 'pt-BR', timezone: 'America/Sao_Paulo' },
  });

  useEffect(() => {
    if (data) {
      reset({
        name: data.name,
        language: (data.language as SettingsForm['language']) ?? 'pt-BR',
        timezone: data.timezone ?? 'America/Sao_Paulo',
      });
    }
  }, [data, reset]);

  const mutation = useMutation({
    mutationFn: (values: SettingsForm) => adminApi.updateSettings(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success(t('tenantAdmin.settings.messages.saved'));
    },
    onError: () => {
      toast.error('Erro ao salvar configurações');
    },
  });

  const selectStyle: React.CSSProperties = {
    background: '#1A1C20',
    border: '1px solid rgba(255,255,255,.07)',
    color: '#F0F1F3',
    height: '2.5rem',
    borderRadius: '0.5rem',
    padding: '0 0.75rem',
    fontSize: '0.875rem',
    width: '100%',
    outline: 'none',
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#F0F1F3' }}>
          {t('tenantAdmin.settings.title')}
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#9DA3AE' }}>
          {t('tenantAdmin.settings.subtitle')}
        </p>
      </div>

      <div
        className="rounded-xl p-6"
        style={{ background: '#141518', border: '1px solid rgba(255,255,255,.07)' }}
      >
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-3" />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
            <Input
              label={t('tenantAdmin.settings.fields.name')}
              error={errors.name?.message}
              {...register('name')}
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: '#9DA3AE' }}>
                {t('tenantAdmin.settings.fields.language')}
              </label>
              <select style={selectStyle} {...register('language')}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: '#9DA3AE' }}>
                {t('tenantAdmin.settings.fields.timezone')}
              </label>
              <select style={selectStyle} {...register('timezone')}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Salvando...' : 'Salvar configurações'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
