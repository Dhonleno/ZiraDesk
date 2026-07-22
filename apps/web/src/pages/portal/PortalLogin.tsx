import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

export function PortalLogin() {
  const { t } = useTranslation('portal');
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const { token, contact } = await portalApi.login(email, password);
      localStorage.setItem('portal_token', token);
      localStorage.setItem('portal_user', JSON.stringify(contact));
      navigate('/portal/dashboard', { replace: true });
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Erro ao fazer login';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="portal-login-page">
      <div className="portal-login-card">
        <div className="portal-login-header">
          <h1>{t('login.title')}</h1>
          <p>{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="portal-field">
            <label htmlFor="portal-email">{t('login.email')}</label>
            <input
              id="portal-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>

          <div className="portal-field">
            <label htmlFor="portal-password">{t('login.password')}</label>
            <input
              id="portal-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button type="submit" disabled={loading} className="portal-btn-primary">
            {loading ? t('login.loading') : t('login.submit')}
          </button>
        </form>

        <Link to="/portal/forgot-password" className="portal-forgot-link">
          {t('auth.forgotPassword')}
        </Link>
      </div>
    </div>
  );
}
