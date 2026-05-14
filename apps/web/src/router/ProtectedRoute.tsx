import type { ReactNode } from 'react';
import type { Permission } from '@ziradesk/shared';
import { Navigate } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission';

interface ProtectedRouteProps {
  permission: Permission;
  children: ReactNode;
  redirectTo?: string;
}

export function ProtectedRoute({ permission, children, redirectTo = '/' }: ProtectedRouteProps) {
  const { can } = usePermission();

  if (!can(permission)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
