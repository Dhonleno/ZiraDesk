import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/auth.store';

// ── Types ────────────────────────────────────────────────────────────────────

interface TenantSettings {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  timezone: string;
  language: string;
}

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
}

interface Channel {
  id: string;
  type: string;
  name: string;
  status: string;
  settings: unknown;
  created_at: string;
}

interface AdminStats {
  total_users: number;
  total_clients: number;
  total_conversations: number;
  open_conversations: number;
  total_tickets: number;
  open_tickets: number;
  total_messages: number;
}

interface PaginatedUsers {
  data: TenantUser[];
  meta: { total: number; page: number; per_page: number; total_pages: number };
}

interface ListUsersParams {
  page?: number;
  per_page?: number;
  search?: string;
  role?: string;
  status?: string;
}

interface InviteUserPayload {
  name: string;
  email: string;
  role: 'admin' | 'agent' | 'viewer';
}

interface CreateChannelPayload {
  type: 'whatsapp' | 'instagram' | 'email' | 'webchat';
  name: string;
  credentials: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

interface UpdateChannelPayload {
  name?: string;
  credentials?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  status?: 'active' | 'inactive';
}

// ── Admin API ─────────────────────────────────────────────────────────────────

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // envia httpOnly cookies (refresh_token)
  headers: {
    'Content-Type': 'application/json',
  },
});

// Injeta o access token em cada requisição
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

function drainQueue(token: string) {
  refreshQueue.forEach((resolve) => resolve(token));
  refreshQueue = [];
}

// Interceptor de resposta: tenta refresh automático em 401
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Só tenta refresh uma vez e apenas para rotas que não sejam de auth
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/auth/')
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve) => {
        refreshQueue.push(resolve);
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const { data } = await api.post<{ accessToken: string }>('/auth/refresh');
      const newToken = data.accessToken;

      useAuthStore.getState().setAuth({ token: newToken });
      drainQueue(newToken);

      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  },
);

export const adminApi = {
  getStats: async (): Promise<AdminStats> => {
    const res = await api.get<{ success: boolean; data: AdminStats }>('/admin/stats/overview');
    return res.data.data;
  },

  getSettings: async (): Promise<TenantSettings> => {
    const res = await api.get<{ success: boolean; data: TenantSettings }>('/admin/settings');
    return res.data.data;
  },

  updateSettings: async (data: Partial<TenantSettings> & { name: string }): Promise<TenantSettings> => {
    const res = await api.patch<{ success: boolean; data: TenantSettings }>('/admin/settings', data);
    return res.data.data;
  },

  listUsers: async (params?: ListUsersParams): Promise<PaginatedUsers> => {
    const res = await api.get<{ success: boolean } & PaginatedUsers>('/admin/users', { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  inviteUser: async (payload: InviteUserPayload) => {
    const res = await api.post<{ success: boolean; data: { user: TenantUser; tempPassword: string } }>(
      '/admin/users/invite',
      payload,
    );
    return res.data;
  },

  updateUser: async (id: string, payload: { name?: string; role?: string; status?: string }) => {
    const res = await api.patch<{ success: boolean; data: TenantUser }>(`/admin/users/${id}`, payload);
    return res.data;
  },

  deleteUser: async (id: string) => {
    const res = await api.delete<{ success: boolean; data: TenantUser }>(`/admin/users/${id}`);
    return res.data;
  },

  listChannels: async (): Promise<Channel[]> => {
    const res = await api.get<{ success: boolean; data: Channel[] }>('/admin/channels');
    return res.data.data;
  },

  createChannel: async (payload: CreateChannelPayload) => {
    const res = await api.post<{ success: boolean; data: Channel }>('/admin/channels', payload);
    return res.data;
  },

  updateChannel: async (id: string, payload: UpdateChannelPayload) => {
    const res = await api.patch<{ success: boolean; data: Channel }>(`/admin/channels/${id}`, payload);
    return res.data;
  },

  deleteChannel: async (id: string) => {
    const res = await api.delete<{ success: boolean; data: Channel }>(`/admin/channels/${id}`);
    return res.data;
  },

  testChannel: async (id: string) => {
    const res = await api.post<{ success: boolean; data: { connected: boolean; channel_id: string } }>(
      `/admin/channels/${id}/test`,
    );
    return res.data;
  },
};
