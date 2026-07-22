import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { decodeJwtPayload } from '../../services/api';
import { clearPortalSession } from '../../hooks/usePortalUser';

export function PortalGuard({ children }: { children: ReactNode }) {
  const token = localStorage.getItem('portal_token');
  if (!token) return <Navigate to="/portal" replace />;

  const payload = decodeJwtPayload(token);
  const now = Math.floor(Date.now() / 1000);
  if (!payload?.exp || payload.exp <= now) {
    clearPortalSession();
    return <Navigate to="/portal" replace />;
  }

  return <>{children}</>;
}
