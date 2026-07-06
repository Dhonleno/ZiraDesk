import { usePermission } from './usePermission';

export function usePiiPermission(): { hasFullPii: boolean } {
  const { can } = usePermission();
  return { hasFullPii: can('pii:view-full') };
}
