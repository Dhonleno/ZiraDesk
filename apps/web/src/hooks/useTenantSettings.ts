import { useQuery } from '@tanstack/react-query';
import { tenantApi } from '../services/api';

export function useTenantSettings() {
  return useQuery({
    queryKey: ['tenant', 'public-settings'],
    queryFn: tenantApi.getPublicSettings,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
