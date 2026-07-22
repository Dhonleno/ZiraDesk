import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

export function PortalResetPassword() {
  const { t } = useTranslation('portal');
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage('');

    if (password.length < 8 || confirmPassword.length < 8) {
      setErrorMessage(t('auth.resetPasswordMinLength'));
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage(t('auth.resetPasswordMismatch'));
      return;
    }
    if (!token) {
      setErrorMessage(t('auth.resetPasswordInvalidToken'));
      return;
    }

    setLoading(true);
    try {
      await portalApi.resetPassword(token, password);
      toast.success(t('auth.resetPasswordSuccess'));
      navigate('/portal', { replace: true });
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? t('auth.resetPasswordInvalidToken');
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="portal-login-page">
      <div className="portal-login-card">
        <div className="portal-login-header">
          <h1>{t('auth.resetPasswordTitle')}</h1>
        </div>

        {!token ? (
          <p className="portal-auth-message portal-auth-error">{t('auth.resetPasswordInvalidToken')}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="portal-field">
              <label htmlFor="portal-reset-password">{t('auth.resetPasswordNew')}</label>
              <input
                id="portal-reset-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>

            <div className="portal-field">
              <label htmlFor="portal-reset-confirm">{t('auth.resetPasswordConfirm')}</label>
              <input
                id="portal-reset-confirm"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>

            {errorMessage ? <p className="portal-auth-message portal-auth-error">{errorMessage}</p> : null}

            <button type="submit" disabled={loading} className="portal-btn-primary">
              {loading ? t('login.loading') : t('auth.resetPasswordSubmit')}
            </button>
          </form>
        )}

        <Link to="/portal" className="portal-forgot-link">
          {t('auth.backToLogin')}
        </Link>
      </div>
    </div>
  );
}
