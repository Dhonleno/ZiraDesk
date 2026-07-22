import { Link, NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LegalDpoLink } from '../components/legal/LegalDpoLink';
import { clearPortalSession, usePortalUser } from '../hooks/usePortalUser';
import { portalApi } from '../services/api';

const PORTAL_THEME_KEY = 'portal-theme';

function getInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getInitialIsDark(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(PORTAL_THEME_KEY);
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function PortalLayout() {
  const { t } = useTranslation('portal');
  const navigate = useNavigate();
  const user = usePortalUser();
  const [isDark, setIsDark] = useState(getInitialIsDark);

  const { data: branding } = useQuery({
    queryKey: ['portal-branding'],
    queryFn: () => portalApi.getBranding(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem(PORTAL_THEME_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    const root = document.documentElement;
    if (branding?.primaryColor) {
      root.style.setProperty('--portal-primary', branding.primaryColor);
    }
    return () => {
      root.style.removeProperty('--portal-primary');
    };
  }, [branding?.primaryColor]);

  return (
    <div className="portal-root">
      <header className="portal-header">
        <div className="portal-logo">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.tenantName} className="portal-logo-img" />
          ) : (
            <div className="portal-logo-icon" aria-hidden="true">Z</div>
          )}
          <span className="portal-logo-name">{branding?.tenantName ?? t('title')}</span>
        </div>

        {user ? (
          <nav className="portal-nav" aria-label={t('nav.ariaLabel')}>
            <NavLink to="/portal/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
              {t('nav.tickets')}
            </NavLink>
            <NavLink to="/portal/tickets/new" className={({ isActive }) => (isActive ? 'active' : '')}>
              {t('nav.newTicket')}
            </NavLink>
            <NavLink to="/portal/privacy" className={({ isActive }) => (isActive ? 'active' : '')}>
              {t('nav.privacy')}
            </NavLink>
          </nav>
        ) : null}

        <div className="portal-user-menu">
          {user ? (
            <>
              <div className="portal-avatar" aria-hidden="true">{getInitials(user.name)}</div>
              <span className="portal-user-name">{user.name}</span>
            </>
          ) : null}
          <button
            type="button"
            className="portal-theme-toggle"
            onClick={() => setIsDark((prev) => !prev)}
            aria-label={t('theme.toggle')}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
          {user ? (
            <button
              type="button"
              className="portal-logout"
              onClick={() => {
                clearPortalSession();
                navigate('/portal', { replace: true });
              }}
              aria-label={t('auth.logout')}
            >
              <LogoutIcon />
            </button>
          ) : null}
        </div>
      </header>
      <main className="portal-main">
        <Outlet />
      </main>
      <footer className="portal-footer">
        <span>Powered by ZiraDesk</span>
        <span aria-hidden>•</span>
        <Link to="/politica-de-privacidade" className="legal-footer-link">Política de Privacidade</Link>
        <span aria-hidden>•</span>
        <Link to="/termos-de-uso" className="legal-footer-link">Termos de Uso</Link>
        <LegalDpoLink prefix={<span aria-hidden>•</span>} />
      </footer>
    </div>
  );
}
