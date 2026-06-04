import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { Input } from '../../components/ui/Input';
import { profileApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';

function getApiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { response?: { data?: { error?: { message?: string } } } }).response;
  return response?.data?.error?.message ?? null;
}

export function ChangePassword() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const setUser = useAuthStore((state) => state.setUser);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'ZiraDesk — Crie sua senha';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const validate = (): string | null => {
    if (newPassword.length < 8 || confirmPassword.length < 8) {
      return t('changePassword.minLength');
    }
    if (newPassword !== confirmPassword) {
      return t('changePassword.mismatch');
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage('');
    setIsSubmitting(true);
    try {
      await profileApi.updatePassword({ currentPassword: undefined, newPassword });
      setUser({ mustChangePassword: false });
      navigate('/', { replace: true });
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error) ?? t('changePassword.minLength'));
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
              {t('changePassword.title')}
            </h1>
            <p style={{ margin: 0, color: 'var(--txt-2)', fontSize: 13, lineHeight: 1.5 }}>
              {t('changePassword.subtitle')}
            </p>
          </div>

          <Input
            label={t('changePassword.newPassword')}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={8}
            required
          />

          <Input
            label={t('changePassword.confirmPassword')}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            minLength={8}
            required
          />

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
            {t('changePassword.submit')}
          </button>
        </form>
      </section>
    </main>
  );
}
