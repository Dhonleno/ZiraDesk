import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';

export function PortalForgotPassword() {
  const { t } = useTranslation('portal');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await portalApi.forgotPassword(email);
    } finally {
      setLoading(false);
      // O backend nunca revela se o e-mail existe — sempre tratamos como sucesso.
      setSent(true);
    }
  }

  return (
    <div className="portal-login-page">
      <div className="portal-login-card">
        <div className="portal-login-header">
          <h1>{t('auth.forgotPasswordTitle')}</h1>
          <p>{t('auth.forgotPasswordDesc')}</p>
        </div>

        {sent ? (
          <p className="portal-auth-message">{t('auth.forgotPasswordSuccess')}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="portal-field">
              <label htmlFor="portal-forgot-email">{t('login.email')}</label>
              <input
                id="portal-forgot-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="seu@email.com"
                required
              />
            </div>

            <button type="submit" disabled={loading} className="portal-btn-primary">
              {loading ? t('login.loading') : t('auth.forgotPasswordSubmit')}
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
