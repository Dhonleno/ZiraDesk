import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

export function PortalGuard({ children }: { children: ReactNode }) {
  const token = localStorage.getItem('portal_token');
  if (!token) return <Navigate to="/portal" replace />;
  return <>{children}</>;
}
