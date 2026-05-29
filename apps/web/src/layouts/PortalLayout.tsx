import { NavLink, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PortalUserMenu } from '../components/portal/PortalUserMenu';
import { BrandLogo } from '../components/layout/BrandLogo';
import { LegalDpoLink } from '../components/legal/LegalDpoLink';
import { usePortalUser } from '../hooks/usePortalUser';

export function PortalLayout() {
  const { t } = useTranslation('portal');
  const user = usePortalUser();

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

  return (
    <div className="portal-root">
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-brand">
            <BrandLogo className="portal-brand-logo" />
            <span className="portal-brand-name">Central de Suporte</span>
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
        <LegalDpoLink />
      </footer>
    </div>
  );
}
