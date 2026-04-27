import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import type { Tenant } from '@ziradesk/shared';

export function useTenant() {
  return useQuery({
    queryKey: ['tenant', 'current'],
    queryFn: async () => {
      const { data } = await api.get<Tenant>('/tenant/me');
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 min — dados de tenant mudam raramente
    retry: false,
  });
}
