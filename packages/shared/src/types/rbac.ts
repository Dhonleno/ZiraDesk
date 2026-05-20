export type Role = 'super_admin' | 'owner' | 'admin' | 'supervisor' | 'agent' | 'viewer';

export type Permission =
  | 'tenant:manage'
  | 'settings:manage'
  | 'users:manage'
  | 'channels:manage'
  | 'contacts:view'
  | 'contacts:edit'
  | 'contacts:delete'
  | 'organizations:view'
  | 'organizations:edit'
  | 'organizations:delete'
  | 'conversations:view'
  | 'conversations:reply'
  | 'conversations:manage'
  | 'tickets:view'
  | 'tickets:edit'
  | 'tickets:delete'
  | 'metrics:view'
  | 'metrics:own';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ['*' as any],
  owner: [
    'settings:manage',
    'users:manage',
    'channels:manage',
    'contacts:view',
    'contacts:edit',
    'contacts:delete',
    'organizations:view',
    'organizations:edit',
    'organizations:delete',
    'conversations:view',
    'conversations:reply',
    'conversations:manage',
    'tickets:view',
    'tickets:edit',
    'tickets:delete',
    'metrics:view',
    'metrics:own',
  ],
  admin: [
    'settings:manage',
    'users:manage',
    'channels:manage',
    'contacts:view',
    'contacts:edit',
    'contacts:delete',
    'organizations:view',
    'organizations:edit',
    'organizations:delete',
    'conversations:view',
    'conversations:reply',
    'conversations:manage',
    'tickets:view',
    'tickets:edit',
    'tickets:delete',
    'metrics:view',
    'metrics:own',
  ],
  supervisor: [
    'contacts:view',
    'contacts:edit',
    'organizations:view',
    'organizations:edit',
    'conversations:view',
    'conversations:manage',
    'tickets:view',
    'tickets:edit',
    'metrics:view',
    'metrics:own',
  ],
  agent: [
    'contacts:view',
    'contacts:edit',
    'organizations:view',
    'organizations:edit',
    'conversations:view',
    'conversations:reply',
    'conversations:manage',
    'tickets:view',
    'tickets:edit',
    'metrics:own',
  ],
  viewer: [
    'contacts:view',
    'organizations:view',
    'conversations:view',
    'tickets:view',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (permissions.includes('*' as any)) return true;
  return permissions.includes(permission);
}
