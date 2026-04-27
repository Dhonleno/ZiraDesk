import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@ziradesk/shared';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';

export function ForgotPassword() {
  const { t } = useTranslation('auth');
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    await api.post('/auth/forgot-password', data);
    setSent(true);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gray-950 px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[500px] w-[500px] rounded-full bg-brand-700/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: '#0F172A',
              border: '1px solid #1E293B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden>
              <path
                d="M6 8 L26 8 L6 24 L26 24"
                fill="none"
                stroke="#F1F5F9"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-2xl tracking-tight" style={{ color: '#F1F5F9' }}>
            <span style={{ fontWeight: 700 }}>Zira</span>
            <span style={{ fontWeight: 300 }}>Desk</span>
          </span>
        </div>

        <Card>
          {sent ? (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-900/40 border border-green-700">
                <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-green-400" aria-hidden>
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-white">{t('forgotPassword.successMessage')}</p>
              </div>
              <Link to="/login" className="text-sm text-brand-400 hover:text-brand-300 transition-colors">
                ← {t('forgotPassword.backToLogin')}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
              <div>
                <h1 className="text-lg font-semibold text-white">{t('forgotPassword.title')}</h1>
                <p className="mt-1 text-sm text-gray-400">{t('forgotPassword.subtitle')}</p>
              </div>

              <Input
                label={t('forgotPassword.email')}
                type="email"
                autoComplete="email"
                placeholder="voce@empresa.com"
                error={errors.email?.message}
                {...register('email')}
              />

              <Button type="submit" loading={isSubmitting} size="lg" className="w-full">
                {t('forgotPassword.submit')}
              </Button>

              <Link
                to="/login"
                className="text-center text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                ← {t('forgotPassword.backToLogin')}
              </Link>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
