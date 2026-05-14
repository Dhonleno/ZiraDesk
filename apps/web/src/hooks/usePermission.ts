import { useAuthStore } from '../stores/auth.store';
import { hasPermission, type Permission, type Role } from '@ziradesk/shared';

export function usePermission() {
  const role = useAuthStore((state) => state.user?.role) as Role | undefined;

  return {
    can: (permission: Permission): boolean => {
      if (!role) return false;
      return hasPermission(role, permission);
    },
    canAny: (...permissions: Permission[]): boolean => {
      if (!role) return false;
      return permissions.some((permission) => hasPermission(role, permission));
    },
    role,
  };
}
