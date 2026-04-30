export type UserRole = 'super_admin' | 'owner' | 'admin' | 'agent' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  createdAt: Date;
}

export interface SuperAdmin {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  schemaName?: string;
  isSuperAdmin: false;
}

export interface AuthSuperAdmin {
  id: string;
  name: string;
  email: string;
  role: 'super_admin';
  isSuperAdmin: true;
  tenantId?: never;
}

export type AuthenticatedUser = AuthUser | AuthSuperAdmin;
