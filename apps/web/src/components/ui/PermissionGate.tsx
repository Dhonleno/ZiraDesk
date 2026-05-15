import type { ReactNode } from 'react';
import type { Permission, Role } from '@ziradesk/shared';
import { usePermission } from '../../hooks/usePermission';

interface PermissionGateProps {
  permission?: Permission;
  anyOf?: Permission[];
  role?: Role | Role[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({ permission, anyOf, role, fallback = null, children }: PermissionGateProps) {
  const { can, canAny, role: currentRole } = usePermission();

  const roleAllowed = !role
    ? true
    : Array.isArray(role)
      ? !!currentRole && role.includes(currentRole)
      : currentRole === role;

  const permissionAllowed = permission
    ? can(permission)
    : anyOf
      ? canAny(...anyOf)
      : true;

  const allowed = roleAllowed && permissionAllowed;

  return <>{allowed ? children : fallback}</>;
}
