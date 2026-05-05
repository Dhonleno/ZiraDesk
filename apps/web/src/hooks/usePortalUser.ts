import type { PortalUser } from '../services/api';

export function getPortalUser(): PortalUser | null {
  const raw = localStorage.getItem('portal_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalUser;
  } catch {
    return null;
  }
}

export function usePortalUser(): PortalUser | null {
  return getPortalUser();
}

export function clearPortalSession() {
  localStorage.removeItem('portal_token');
  localStorage.removeItem('portal_user');
}
