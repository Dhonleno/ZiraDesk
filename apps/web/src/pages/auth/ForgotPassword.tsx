import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { Input } from '../../components/ui/Input';
import { api } from '../../services/api';

function getApiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { response?: { data?: { error?: string } } }).response;
  return response?.data?.error ?? null;
}

export function ForgotPassword() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;

    setErrorMessage('');
    setIsSubmitting(true);
    try {
      await api.post('/auth/forgot-password', {
        email,
        ...(import.meta.env.DEV && tenantSlug ? { tenantSlug } : {}),
      });
      setSent(true);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error) ?? t('forgotPassword.submit'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        overflow: 'hidden',
        background: 'var(--bg)',
        color: 'var(--txt)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        fontFamily: 'var(--font)',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'var(--teal-dim)',
            filter: 'blur(120px)',
          }}
        />
      </div>

      <section style={{ position: 'relative', width: '100%', maxWidth: 384, zIndex: 1 }}>
        <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandLogo variant="icon" tone="dark" width={40} height={40} ariaLabel="ZiraDesk" />
            <span style={{ color: 'var(--txt)', fontSize: 30, lineHeight: 1, letterSpacing: 0 }}>
              <span style={{ fontWeight: 600 }}>Zira</span>
              <span style={{ fontWeight: 300, color: 'var(--txt-2)' }}>Desk</span>
            </span>
          </div>
        </div>

        {sent ? (
          <div
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--bg-2)',
              boxShadow: 'var(--shadow-pop)',
              padding: 24,
              display: 'grid',
              gap: 16,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--teal-dim)',
                border: '1px solid var(--teal)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" width={24} height={24} aria-hidden>
                <path d="M20 6L9 17l-5-5" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p style={{ margin: 0, color: 'var(--txt)', fontWeight: 500, fontSize: 15 }}>
              {t('forgotPassword.success')}
            </p>
            <button
              type="button"
              className="tb-btn"
              style={{ width: '100%', minHeight: 40 }}
              onClick={() => navigate('/login')}
            >
              {t('forgotPassword.backToLogin')}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(event)}
            noValidate
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--bg-2)',
              boxShadow: 'var(--shadow-pop)',
              padding: 24,
              display: 'grid',
              gap: 16,
            }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <h1 style={{ margin: 0, color: 'var(--txt)', fontSize: 22, fontWeight: 600, letterSpacing: 0 }}>
                {t('forgotPassword.title')}
              </h1>
              <p style={{ margin: 0, color: 'var(--txt-2)', fontSize: 13, lineHeight: 1.5 }}>
                {t('forgotPassword.subtitle')}
              </p>
            </div>

            <Input
              label={t('forgotPassword.email')}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            {import.meta.env.DEV && (
              <Input
                label="Workspace (dev)"
                placeholder="meu-tenant"
                value={tenantSlug}
                onChange={(event) => setTenantSlug(event.target.value)}
              />
            )}

            {errorMessage ? (
              <div
                role="alert"
                style={{
                  border: '1px solid var(--red-dim)',
                  borderRadius: 'var(--r)',
                  background: 'var(--red-dim)',
                  color: 'var(--red)',
                  fontSize: 12,
                  padding: '9px 11px',
                }}
              >
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="tb-btn tb-btn-primary"
              style={{ width: '100%', minHeight: 40 }}
            >
              {isSubmitting ? t('forgotPassword.sending') : t('forgotPassword.submit')}
            </button>

            <button
              type="button"
              className="tb-btn"
              style={{ width: '100%', minHeight: 40 }}
              onClick={() => navigate('/login')}
            >
              {t('forgotPassword.backToLogin')}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
