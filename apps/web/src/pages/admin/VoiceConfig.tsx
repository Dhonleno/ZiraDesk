import { useEffect, useMemo } from 'react';
import type { AxiosError } from 'axios';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageShell } from '../../components/layout/PageShell';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { adminApi, type UpdateVoiceConfigPayload } from '../../services/api';
import { useToast } from '../../stores/toast.store';

const voiceConfigSchema = z.object({
  twilioPhoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/),
  defaultBotMenuId: z.string().uuid().nullable(),
  ivrEnabled: z.boolean(),
  ringTimeoutSeconds: z.number().int().min(5).max(60),
});

type VoiceConfigForm = z.infer<typeof voiceConfigSchema>;

function normalizeE164Input(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 15);
  return digits ? `+${digits}` : value.includes('+') ? '+' : '';
}

function menuLabel(greeting: string): string {
  const normalized = greeting.trim().replace(/\s+/g, ' ');
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}

export function VoiceConfig() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const formSchema = useMemo(() => voiceConfigSchema.extend({
    twilioPhoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, t('tenantAdmin.voiceConfig.errors.invalidPhone')),
    ringTimeoutSeconds: z.number()
      .int()
      .min(5, t('tenantAdmin.voiceConfig.errors.timeoutRange'))
      .max(60, t('tenantAdmin.voiceConfig.errors.timeoutRange')),
  }), [t]);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<VoiceConfigForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      twilioPhoneNumber: '',
      defaultBotMenuId: null,
      ivrEnabled: true,
      ringTimeoutSeconds: 20,
    },
  });

  const configQuery = useQuery({
    queryKey: ['admin', 'voice-config'],
    queryFn: adminApi.voiceConfig.get,
  });

  const botMenuQuery = useQuery({
    queryKey: ['admin', 'bot'],
    queryFn: adminApi.bot.getMenu,
  });

  useEffect(() => {
    if (!configQuery.data) return;
    reset({
      twilioPhoneNumber: configQuery.data.twilioPhoneNumber,
      defaultBotMenuId: configQuery.data.defaultBotMenuId,
      ivrEnabled: configQuery.data.ivrEnabled,
      ringTimeoutSeconds: configQuery.data.ringTimeoutSeconds,
    });
  }, [configQuery.data, reset]);

  const mutation = useMutation({
    mutationFn: (payload: UpdateVoiceConfigPayload) => adminApi.voiceConfig.update(payload),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'voice-config'] });
      reset({
        twilioPhoneNumber: data.twilioPhoneNumber,
        defaultBotMenuId: data.defaultBotMenuId,
        ivrEnabled: data.ivrEnabled,
        ringTimeoutSeconds: data.ringTimeoutSeconds,
      });
      toast.success(t('tenantAdmin.voiceConfig.saved'));
    },
    onError: (error: AxiosError<{ error?: { code?: string; message?: string } }>) => {
      if (error.response?.data?.error?.code === 'DUPLICATE_TWILIO_PHONE_NUMBER') {
        toast.error(t('tenantAdmin.voiceConfig.errors.duplicatePhone'));
        return;
      }
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.voiceConfig.errors.save'));
    },
  });

  const isLoading = configQuery.isLoading || botMenuQuery.isLoading;
  const menu = botMenuQuery.data;

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 24, gap: 20 }}>
        <header style={{ flexShrink: 0 }}>
          <h1 style={{ margin: 0, color: 'var(--txt)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px' }}>
            {t('tenantAdmin.voiceConfig.title')}
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--txt-2)', fontSize: 12 }}>
            {t('tenantAdmin.voiceConfig.subtitle')}
          </p>
        </header>

        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)',
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}>
            {isLoading ? (
              <div style={{ display: 'grid', gap: 14 }}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    style={{ height: 62, borderRadius: 'var(--r)', background: 'var(--bg-3)', opacity: 0.55 }}
                  />
                ))}
              </div>
            ) : (
              <section style={{ display: 'grid', gap: 20, maxWidth: 760 }}>
                <div>
                  <h2 style={{
                    margin: '0 0 14px',
                    color: 'var(--txt-3)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}>
                    {t('tenantAdmin.voiceConfig.sectionTitle')}
                  </h2>

                  <div style={{ display: 'grid', gap: 18 }}>
                    <Controller
                      name="twilioPhoneNumber"
                      control={control}
                      render={({ field }) => (
                        <Input
                          ref={field.ref}
                          name={field.name}
                          value={field.value}
                          onBlur={field.onBlur}
                          onChange={(event) => field.onChange(normalizeE164Input(event.target.value))}
                          label={t('tenantAdmin.voiceConfig.twilioPhoneNumber')}
                          hint={t('tenantAdmin.voiceConfig.twilioPhoneNumberHint')}
                          error={errors.twilioPhoneNumber?.message}
                          placeholder="+5562999999999"
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={16}
                          style={{ fontFamily: 'var(--mono)' }}
                        />
                      )}
                    />

                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ color: 'var(--txt-2)', fontSize: 13, fontWeight: 500 }}>
                        {t('tenantAdmin.voiceConfig.defaultBotMenu')}
                      </span>
                      <select
                        {...register('defaultBotMenuId', {
                          setValueAs: (value) => value || null,
                        })}
                        aria-label={t('tenantAdmin.voiceConfig.defaultBotMenu')}
                        className="filter-select"
                        style={{ width: '100%', height: 40, background: 'var(--bg-3)' }}
                      >
                        <option value="">{t('tenantAdmin.voiceConfig.noBotMenu')}</option>
                        {menu && (
                          <option value={menu.id}>
                            {menuLabel(menu.greeting)}
                          </option>
                        )}
                      </select>
                    </label>

                    <Controller
                      name="ivrEnabled"
                      control={control}
                      render={({ field }) => (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                          padding: '12px 14px',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--r)',
                          background: 'var(--bg-3)',
                        }}>
                          <span style={{ color: 'var(--txt)', fontSize: 13, fontWeight: 500 }}>
                            {t('tenantAdmin.voiceConfig.ivrEnabled')}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={field.value}
                            aria-label={t('tenantAdmin.voiceConfig.ivrEnabled')}
                            onClick={() => field.onChange(!field.value)}
                            style={{
                              width: 38,
                              height: 22,
                              padding: 2,
                              display: 'flex',
                              alignItems: 'center',
                              border: '1px solid var(--line-2)',
                              borderRadius: 'var(--r-pill)',
                              background: field.value ? 'var(--teal)' : 'var(--bg-4)',
                              cursor: 'pointer',
                              transition: 'background .15s ease',
                            }}
                          >
                            <span style={{
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              background: field.value ? 'var(--on-teal)' : 'var(--txt-2)',
                              transform: `translateX(${field.value ? 16 : 0}px)`,
                              transition: 'transform .15s ease',
                            }}
                            />
                          </button>
                        </div>
                      )}
                    />

                    <Input
                      type="number"
                      min={5}
                      max={60}
                      label={t('tenantAdmin.voiceConfig.ringTimeout')}
                      error={errors.ringTimeoutSeconds?.message}
                      {...register('ringTimeoutSeconds', { valueAsNumber: true })}
                      style={{ fontFamily: 'var(--mono)' }}
                    />
                  </div>
                </div>
              </section>
            )}
          </div>

          <footer style={{
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderTop: '1px solid var(--line)',
            background: 'var(--bg-2)',
          }}>
            <Button type="submit" loading={mutation.isPending} disabled={isLoading || !isDirty}>
              {mutation.isPending
                ? t('tenantAdmin.common.saving')
                : t('tenantAdmin.common.save')}
            </Button>
          </footer>
        </form>
      </div>
    </PageShell>
  );
}
