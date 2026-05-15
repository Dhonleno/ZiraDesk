import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { PortalUserMenu } from '../components/portal/PortalUserMenu';
import { BrandLogo } from '../components/layout/BrandLogo';

export function PortalLayout() {
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
          <PortalUserMenu />
        </div>
      </header>
      <main className="portal-main">
        <Outlet />
      </main>
      <footer className="portal-footer">
        <span>Powered by ZiraDesk</span>
      </footer>
    </div>
  );
}
