import type { ReactNode } from 'react';
import type { Permission } from '@ziradesk/shared';
import { usePermission } from '../../hooks/usePermission';

interface PermissionGateProps {
  permission?: Permission;
  anyOf?: Permission[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({ permission, anyOf, fallback = null, children }: PermissionGateProps) {
  const { can, canAny } = usePermission();

  const allowed = permission
    ? can(permission)
    : anyOf
      ? canAny(...anyOf)
      : true;

  return <>{allowed ? children : fallback}</>;
}
