import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loginSchema, type LoginInput } from '@ziradesk/shared';
import { useAuth } from '../../hooks/useAuth';
import { legalApi } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { LegalDpoLink } from '../../components/legal/LegalDpoLink';

function ThemeToggle() {
  const toggle = useCallback(() => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('zd-theme', next); } catch (_) {}
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'zd-theme' && e.newValue) {
        document.documentElement.setAttribute('data-theme', e.newValue);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <button type="button" onClick={toggle} className="tb-icon-btn theme-toggle login-theme-toggle" aria-label="Alternar tema">
      <svg className="icon-sun" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <svg className="icon-moon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function isExternalUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

export function Login() {
  const { t } = useTranslation('auth');
  const { login, isLoggingIn, loginError } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const { data: legalInfo } = useQuery({
    queryKey: ['legal', 'dpo'],
    queryFn: legalApi.getDpo,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = (data: LoginInput) => login(data);
  const hasDpoInfo = Boolean(
    legalInfo?.name
    || legalInfo?.email
    || legalInfo?.phone
    || legalInfo?.privacyPolicyUrl
    || legalInfo?.termsUrl,
  );
  const legalLinks = useMemo(() => {
    const links: ReactNode[] = [];

    const privacyUrl = legalInfo?.privacyPolicyUrl || '/politica-de-privacidade';
    if (isExternalUrl(privacyUrl)) {
      links.push(
        <a
          key="privacy"
          className="login-legal-link"
          href={privacyUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t('login.legal.privacyPolicy')}
        </a>,
      );
    } else {
      links.push(
        <Link key="privacy" className="login-legal-link" to={privacyUrl}>
          {t('login.legal.privacyPolicy')}
        </Link>,
      );
    }

    const termsUrl = legalInfo?.termsUrl || '/termos-de-uso';
    if (isExternalUrl(termsUrl)) {
      links.push(
        <a
          key="terms"
          className="login-legal-link"
          href={termsUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t('login.legal.termsOfService')}
        </a>,
      );
    } else {
      links.push(
        <Link key="terms" className="login-legal-link" to={termsUrl}>
          {t('login.legal.termsOfService')}
        </Link>,
      );
    }

    if (hasDpoInfo) {
      links.push(
        <LegalDpoLink key="dpo" label={t('login.legal.dpo')} className="login-legal-link" />,
      );
    }

    return links;
  }, [hasDpoInfo, legalInfo?.privacyPolicyUrl, legalInfo?.termsUrl, t]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4" style={{ background: 'var(--bg)' }}>
      <ThemeToggle />
      {/* Glow de fundo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-[500px] w-[500px] rounded-full blur-[120px]" style={{ background: 'var(--teal-dim)' }} />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3.5">
          <div className="flex items-center gap-3">
            <BrandLogo variant="icon" tone="dark" width={40} height={40} ariaLabel="ZiraDesk" />
            <span className="text-[30px] leading-none tracking-[-0.5px]" style={{ color: 'var(--txt)' }}>
              <span style={{ fontWeight: 600 }}>Zira</span>
              <span style={{ fontWeight: 300, color: 'var(--txt-2)' }}>Desk</span>
            </span>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>{t('login.subtitle')}</p>
        </div>

        <Card className="login-card">
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <Input
              label={t('login.email')}
              type="email"
              autoComplete="email"
              aria-required
              placeholder={t('login.emailPlaceholder')}
              error={errors.email?.message}
              {...register('email')}
            />

            {import.meta.env.DEV && (
              <Input
                label="Workspace (dev)"
                placeholder="meu-tenant"
                error={errors.tenantSlug?.message}
                {...register('tenantSlug')}
              />
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                {t('login.password')}
              </label>
              <div className="login-password-wrap">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  aria-required
                  placeholder={t('login.passwordPlaceholder')}
                  className="login-password-input"
                  {...register('password')}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  title={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M1.2 7c1.3-2.3 3.4-3.8 5.8-3.8 2.4 0 4.5 1.5 5.8 3.8-1.3 2.3-3.4 3.8-5.8 3.8-2.4 0-4.5-1.5-5.8-3.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M1.2 7c1.3-2.3 3.4-3.8 5.8-3.8 2.4 0 4.5 1.5 5.8 3.8-1.3 2.3-3.4 3.8-5.8 3.8-2.4 0-4.5-1.5-5.8-3.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M2 12 12 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              </div>
              {errors.password?.message && (
                <p className="text-xs" style={{ color: 'var(--red)' }}>
                  {errors.password.message}
                </p>
              )}
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
            >
              {t('login.submit')}
            </Button>

            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-xs transition-colors login-forgot-link"
              >
                {t('login.forgotPassword')}
              </Link>
            </div>
          </form>
        </Card>

        <div className="mt-6 text-center">
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
          © {new Date().getFullYear()} ZiraDesk. Todos os direitos reservados.
          </p>
          {legalInfo?.companyCnpj ? (
            <p className="login-company-cnpj">
              {(legalInfo.companyLegalName || 'ZiraDesk')}
              {' — CNPJ: '}
              {legalInfo.companyCnpj}
            </p>
          ) : null}
          {legalLinks.length > 0 ? (
            <div className="login-legal-links">
              {legalLinks.map((linkNode, index) => (
                <span key={`legal-link-${index}`} className="login-legal-link-item">
                  {index > 0 ? <span className="login-legal-separator" aria-hidden>·</span> : null}
                  {linkNode}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
