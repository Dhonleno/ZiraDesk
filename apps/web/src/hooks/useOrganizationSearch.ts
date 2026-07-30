import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '../services/api';
import { useAuthStore } from '../stores/auth.store';

interface Options {
  /** Termo já debounced. Vazio lista as primeiras `perPage` organizações. */
  search?: string;
  enabled?: boolean;
  perPage?: number;
}

/**
 * Busca de organizações compartilhada pelos pontos que precisam escolher uma:
 * LinkOrganizationModal (com busca) e os modais de criar/editar contato (select).
 * Extraído para não nascer uma terceira cópia da mesma query.
 */
export function useOrganizationSearch({ search = '', enabled = true, perPage = 10 }: Options = {}) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const token = useAuthStore((state) => state.token);
  const hasValidSession = isAuthenticated && Boolean(token);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-organizations-search', search, perPage],
    queryFn: () => {
      const params: Parameters<typeof organizationsApi.list>[0] = { per_page: perPage };
      if (search) params.search = search;
      return organizationsApi.list(params);
    },
    enabled: enabled && hasValidSession,
  });

  return { organizations: data?.data ?? [], isLoading };
}
