import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loginSchema, type LoginInput } from '@ziradesk/shared';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';

export function Login() {
  const { t } = useTranslation('auth');
  const { login, isLoggingIn, loginError } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = (data: LoginInput) => login(data);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gray-950 px-4">
      {/* Glow de fundo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-[500px] w-[500px] rounded-full bg-brand-700/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
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
          <p className="text-sm text-gray-500">{t('login.subtitle')}</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <Input
              label={t('login.email')}
              type="email"
              autoComplete="email"
              placeholder={t('login.emailPlaceholder')}
              error={errors.email?.message}
              {...register('email')}
            />

            <div className="flex flex-col gap-1.5">
              <Input
                label={t('login.password')}
                type="password"
                autoComplete="current-password"
                placeholder={t('login.passwordPlaceholder')}
                error={errors.password?.message}
                {...register('password')}
              />
              <div className="flex justify-end">
                <Link
                  to="/forgot-password"
                  className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  {t('login.forgotPassword')}
                </Link>
              </div>
            </div>

            {loginError && (
              <p className="rounded-lg bg-red-950/60 border border-red-800 px-3 py-2 text-sm text-red-400">
                {t('login.errors.invalidCredentials')}
              </p>
            )}

            <Button
              type="submit"
              loading={isLoggingIn}
              size="lg"
              className="mt-2 w-full font-semibold"
              style={{ background: '#00C9A7', color: '#0E1A18' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#00E8C0'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#00C9A7'; }}
            >
              {t('login.submit')}
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-gray-600">
          © {new Date().getFullYear()} ZiraDesk. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
