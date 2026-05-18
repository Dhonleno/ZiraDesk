import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/api';

interface CurrentTenantSummary {
  id: string;
  slug?: string;
  name: string;
}

export function useTenant() {
  return useQuery({
    queryKey: ['tenant', 'current'],
    queryFn: async (): Promise<CurrentTenantSummary> => {
      const settings = await adminApi.getSettings();
      return {
        id: settings.id,
        name: settings.name,
        ...(settings.slug ? { slug: settings.slug } : {}),
      };
    },
    staleTime: 5 * 60 * 1000, // 5 min — dados de tenant mudam raramente
    retry: false,
  });
}
