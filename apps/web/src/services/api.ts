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

// ── CRM Types ─────────────────────────────────────────────────────────────────

export type CrmStatus = 'lead' | 'prospect' | 'cliente' | 'vip' | 'inativo' | 'negociando';

export interface CrmClient {
  id: string;
  type: string;
  name: string;
  email: string | null;
  phone: string | null;
  document: string | null;
  website: string | null;
  status: CrmStatus;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  birth_date: string | null;
  gender: string | null;
  occupation: string | null;
  income: number | null;
  segment: string | null;
  lead_source: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  responsible_email: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  ltv: number;
  health_score: number;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmClientStats {
  total_conversations: number;
  open_conversations: number;
  total_tickets: number;
  open_tickets: number;
  total_messages: number;
  last_contact_at: string | null;
}

export interface CrmTimelineEvent {
  id: string;
  type: 'audit' | 'conversation' | 'ticket';
  title: string;
  subtitle: string | null;
  time: string;
  dot_color: string;
}

interface CrmListMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface ListClientsParams {
  page?: number;
  per_page?: number;
  search?: string;
  status?: string;
  type?: string;
  responsible_id?: string;
  tag?: string;
  segment?: string;
  sort_by?: 'name' | 'created_at' | 'updated_at' | 'last_contact';
  sort_order?: 'asc' | 'desc';
}

interface CreateCrmClientPayload {
  name: string;
  type?: 'person' | 'company';
  email?: string;
  phone?: string;
  document?: string;
  website?: string;
  status?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  birth_date?: string;
  gender?: string;
  occupation?: string;
  income?: number;
  segment?: string;
  lead_source?: string;
  responsible_id?: string;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
}

// ── CRM API ───────────────────────────────────────────────────────────────────

export const crmApi = {
  listClients: async (params?: ListClientsParams): Promise<{ data: CrmClient[]; meta: CrmListMeta }> => {
    const res = await api.get<{ success: boolean; data: CrmClient[]; meta: CrmListMeta }>('/crm/clients', { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  getClient: async (id: string): Promise<CrmClient> => {
    const res = await api.get<{ success: boolean; data: CrmClient }>(`/crm/clients/${id}`);
    return res.data.data;
  },

  createClient: async (payload: CreateCrmClientPayload): Promise<CrmClient> => {
    const res = await api.post<{ success: boolean; data: CrmClient }>('/crm/clients', payload);
    return res.data.data;
  },

  updateClient: async (id: string, payload: Partial<CreateCrmClientPayload>): Promise<CrmClient> => {
    const res = await api.patch<{ success: boolean; data: CrmClient }>(`/crm/clients/${id}`, payload);
    return res.data.data;
  },

  deleteClient: async (id: string) => {
    const res = await api.delete<{ success: boolean; data: CrmClient }>(`/crm/clients/${id}`);
    return res.data;
  },

  getClientStats: async (id: string): Promise<CrmClientStats> => {
    const res = await api.get<{ success: boolean; data: CrmClientStats }>(`/crm/clients/${id}/stats`);
    return res.data.data;
  },

  getClientTimeline: async (id: string): Promise<CrmTimelineEvent[]> => {
    const res = await api.get<{ success: boolean; data: CrmTimelineEvent[] }>(`/crm/clients/${id}/timeline`);
    return res.data.data;
  },

  addTag: async (id: string, tag: string): Promise<CrmClient> => {
    const res = await api.post<{ success: boolean; data: CrmClient }>(`/crm/clients/${id}/tags`, { tag });
    return res.data.data;
  },

  removeTag: async (id: string, tag: string): Promise<CrmClient> => {
    const res = await api.delete<{ success: boolean; data: CrmClient }>(`/crm/clients/${id}/tags/${encodeURIComponent(tag)}`);
    return res.data.data;
  },
};

// ── Admin API ─────────────────────────────────────────────────────────────────

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
