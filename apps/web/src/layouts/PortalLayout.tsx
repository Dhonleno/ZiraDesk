import { Link, NavLink, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PortalUserMenu } from '../components/portal/PortalUserMenu';
import { BrandLogo } from '../components/layout/BrandLogo';
import { LegalDpoLink } from '../components/legal/LegalDpoLink';
import { usePortalUser } from '../hooks/usePortalUser';
import { portalApi } from '../services/api';

export function PortalLayout() {
  const { t } = useTranslation('portal');
  const user = usePortalUser();

  const { data: branding } = useQuery({
    queryKey: ['portal-branding'],
    queryFn: () => portalApi.getBranding(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    return () => {
      if (previousTheme) {
        document.documentElement.setAttribute('data-theme', previousTheme);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    };
  }, []);

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
        <div className="portal-header-inner">
          <div className="portal-brand">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.tenantName} className="portal-brand-logo portal-brand-logo-img" />
            ) : (
              <BrandLogo className="portal-brand-logo" />
            )}
            <span className="portal-brand-name">{branding?.tenantName ?? t('title')}</span>
          </div>
          {user ? (
            <nav className="portal-nav" aria-label={t('nav.ariaLabel')}>
              <NavLink to="/portal/dashboard" className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}>
                {t('nav.dashboard')}
              </NavLink>
              <NavLink to="/portal/tickets" className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}>
                {t('nav.tickets')}
              </NavLink>
              <NavLink to="/portal/privacy" className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}>
                {t('nav.privacy')}
              </NavLink>
            </nav>
          ) : null}
          <PortalUserMenu />
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
