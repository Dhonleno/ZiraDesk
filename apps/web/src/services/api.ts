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
  created_at?: string;
  plan?: { id: string; name: string; slug: string; priceMonth: string };
}

export interface TenantUser {
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

// ── Tickets Types ─────────────────────────────────────────────────────────────

export type TicketStatus   = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Ticket {
  id:              string;
  client_id:       string | null;
  conversation_id: string | null;
  title:           string;
  description:     string | null;
  status:          TicketStatus;
  priority:        TicketPriority;
  category:        string | null;
  assigned_to:     string | null;
  resolved_at:     string | null;
  due_date:        string | null;
  tags:            string[];
  custom_fields:   Record<string, unknown>;
  created_at:      string;
  updated_at:      string;
  assignee_name:   string | null;
  assignee_avatar: string | null;
  client_name:     string | null;
  client_email:    string | null;
}

export interface TicketComment {
  id:            string;
  ticket_id:     string;
  user_id:       string;
  content:       string;
  is_internal:   boolean;
  created_at:    string;
  author_name:   string | null;
  author_avatar: string | null;
}

export interface TicketStats {
  total_tickets:            number;
  open_tickets:             number;
  in_progress_tickets:      number;
  waiting_tickets:          number;
  resolved_today:           number;
  by_priority: { low: number; medium: number; high: number; urgent: number };
  avg_resolution_time_hours: number | null;
}

interface TicketListMeta {
  total:       number;
  page:        number;
  per_page:    number;
  total_pages: number;
}

export interface ListTicketsParams {
  page?:        number;
  per_page?:    number;
  search?:      string;
  status?:      TicketStatus;
  priority?:    TicketPriority;
  assigned_to?: string;
  client_id?:   string;
  category?:    string;
  sort_by?:     'created_at' | 'updated_at' | 'priority' | 'due_date';
  sort_order?:  'asc' | 'desc';
}

export interface CreateTicketPayload {
  title:           string;
  description?:    string;
  status?:         TicketStatus;
  priority?:       TicketPriority;
  category?:       string;
  assigned_to?:    string;
  client_id?:      string;
  conversation_id?: string;
  due_date?:       string;
  tags?:           string[];
}

export interface CreateCommentPayload {
  content:     string;
  is_internal: boolean;
}

// ── Tickets API ───────────────────────────────────────────────────────────────

// ── Omnichannel Types ─────────────────────────────────────────────────────────

export interface OmnichannelConversation {
  id: string;
  status: string;
  channel_type: string;
  subject: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  resolved_at: string | null;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
  unread_count?: number;
}

export interface OmnichannelMessage {
  id: string;
  conversation_id: string;
  sender_type: 'agent' | 'client' | 'bot' | 'system';
  sender_id: string | null;
  content: string;
  content_type: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  is_internal: boolean;
  created_at: string;
}

export interface ListConversationsParams {
  page?: number;
  perPage?: number;
  per_page?: number;
  search?: string;
  status?: string;
  assigned_to_me?: boolean;
  client_id?: string;
}

export interface CreateConversationPayload {
  client_id: string;
  channel_id: string;
  subject?: string;
  initial_message?: string;
}

export interface SendMessagePayload {
  content: string;
  contentType?: string;
  isInternal?: boolean;
}

export interface ListMessagesParams {
  page?: number;
  per_page?: number;
  before?: string;
}

export interface OmnichannelMessagesPage {
  data: OmnichannelMessage[];
  has_more: boolean;
  total: number;
}

export interface NotificationItem {
  id: string;
  type: 'ticket_assigned' | 'conversation_assigned' | 'ticket_comment';
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  href: string;
}

export interface GlobalSearchResult {
  clients: Array<{ id: string; name: string; email: string | null; phone: string | null }>;
  tickets: Array<{ id: string; title: string; status: string }>;
  conversations: Array<{ id: string; last_message: string | null; client_name: string | null }>;
}

export interface OnboardingStatus {
  has_users: boolean;
  has_channels: boolean;
  has_clients: boolean;
  has_conversations: boolean;
  tenant_created_at?: string;
  completion?: number;
  is_new_tenant?: boolean;
}

// ── Omnichannel API ───────────────────────────────────────────────────────────

export const omnichannelApi = {
  listConversations: async (params?: ListConversationsParams): Promise<OmnichannelConversation[]> => {
    const res = await api.get<{ success: boolean; data: OmnichannelConversation[] }>(
      '/omnichannel/conversations',
      { params },
    );
    return res.data.data;
  },

  getConversation: async (id: string): Promise<{ conversation: OmnichannelConversation; messages: OmnichannelMessage[] }> => {
    const res = await api.get<{ success: boolean; data: { conversation: OmnichannelConversation; messages: OmnichannelMessage[] } }>(
      `/omnichannel/conversations/${id}`,
    );
    return res.data.data;
  },

  createConversation: async (payload: CreateConversationPayload): Promise<OmnichannelConversation> => {
    const res = await api.post<{ success: boolean; data: OmnichannelConversation }>(
      '/omnichannel/conversations',
      payload,
    );
    return res.data.data;
  },

  listMessages: async (
    conversationId: string,
    params?: ListMessagesParams,
  ): Promise<OmnichannelMessagesPage> => {
    const res = await api.get<{ success: boolean; data: OmnichannelMessage[]; has_more: boolean; total: number }>(
      `/omnichannel/conversations/${conversationId}/messages`,
      { params },
    );
    return { data: res.data.data, has_more: res.data.has_more, total: res.data.total };
  },

  sendMessage: async (conversationId: string, payload: SendMessagePayload): Promise<OmnichannelMessage> => {
    const res = await api.post<{ success: boolean; data: OmnichannelMessage }>(
      `/omnichannel/conversations/${conversationId}/messages`,
      payload,
    );
    return res.data.data;
  },

  updateConversation: async (
    conversationId: string,
    payload: {
      status?: 'open' | 'in_service' | 'pending' | 'resolved' | 'bot' | 'closed';
      assignedTo?: string | null;
      csat_score?: number;
      csat_comment?: string;
    },
  ): Promise<OmnichannelConversation> => {
    const res = await api.patch<{ success: boolean; data: OmnichannelConversation }>(
      `/omnichannel/conversations/${conversationId}`,
      payload,
    );
    return res.data.data;
  },

  resolve: async (
    conversationId: string,
    payload?: { csat_score?: number; csat_comment?: string },
  ): Promise<OmnichannelConversation> => {
    const body: {
      status: 'resolved';
      csat_score?: number;
      csat_comment?: string;
    } = {
      status: 'resolved',
    };
    if (payload?.csat_score !== undefined) body.csat_score = payload.csat_score;
    if (payload?.csat_comment !== undefined) body.csat_comment = payload.csat_comment;
    return omnichannelApi.updateConversation(conversationId, body);
  },

  close: async (conversationId: string): Promise<OmnichannelConversation> => {
    return omnichannelApi.updateConversation(conversationId, { status: 'closed' });
  },

  reopen: async (conversationId: string): Promise<OmnichannelConversation> => {
    return omnichannelApi.updateConversation(conversationId, { status: 'open' });
  },

  assign: async (conversationId: string, userId: string): Promise<OmnichannelConversation> => {
    const res = await api.post<{ success: boolean; data: OmnichannelConversation }>(
      `/omnichannel/conversations/${conversationId}/assign`,
      { user_id: userId },
    );
    return res.data.data;
  },

  transfer: async (conversationId: string, userId: string, reason?: string): Promise<OmnichannelConversation> => {
    const res = await api.post<{ success: boolean; data: OmnichannelConversation }>(
      `/omnichannel/conversations/${conversationId}/transfer`,
      { user_id: userId, reason },
    );
    return res.data.data;
  },
};

export const notificationsApi = {
  list: async (): Promise<NotificationItem[]> => {
    const res = await api.get<{ success: boolean; data: NotificationItem[] }>('/notifications');
    return res.data.data;
  },

  markRead: async (id: string) => {
    const res = await api.patch<{ success: boolean; data: { read: boolean } }>(`/notifications/${id}/read`);
    return res.data.data;
  },

  markAllRead: async () => {
    const res = await api.patch<{ success: boolean; data: { read: number } }>('/notifications/read-all');
    return res.data.data;
  },
};

export const searchApi = {
  global: async (q: string, limit = 5): Promise<GlobalSearchResult> => {
    const res = await api.get<{ success: boolean; data: GlobalSearchResult }>('/search', {
      params: { q, limit },
    });
    return res.data.data;
  },
};

export const onboardingApi = {
  getStatus: async (): Promise<OnboardingStatus> => {
    const res = await api.get<{ success: boolean; data: OnboardingStatus }>('/admin/onboarding-status');
    return res.data.data;
  },
};

// ── Tickets Types ─────────────────────────────────────────────────────────────

export const ticketsApi = {
  list: async (params?: ListTicketsParams): Promise<{ data: Ticket[]; meta: TicketListMeta }> => {
    const res = await api.get<{ success: boolean; data: Ticket[]; meta: TicketListMeta }>('/tickets', { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  getStats: async (): Promise<TicketStats> => {
    const res = await api.get<{ success: boolean; data: TicketStats }>('/tickets/stats');
    return res.data.data;
  },

  get: async (id: string): Promise<Ticket> => {
    const res = await api.get<{ success: boolean; data: Ticket }>(`/tickets/${id}`);
    return res.data.data;
  },

  create: async (payload: CreateTicketPayload): Promise<Ticket> => {
    const res = await api.post<{ success: boolean; data: Ticket }>('/tickets', payload);
    return res.data.data;
  },

  update: async (id: string, payload: Partial<CreateTicketPayload>): Promise<Ticket> => {
    const res = await api.patch<{ success: boolean; data: Ticket }>(`/tickets/${id}`, payload);
    return res.data.data;
  },

  delete: async (id: string) => {
    const res = await api.delete<{ success: boolean; data: Ticket }>(`/tickets/${id}`);
    return res.data;
  },

  assign: async (id: string, userId: string): Promise<Ticket> => {
    const res = await api.post<{ success: boolean; data: Ticket }>(`/tickets/${id}/assign`, { user_id: userId });
    return res.data.data;
  },

  listComments: async (ticketId: string): Promise<TicketComment[]> => {
    const res = await api.get<{ success: boolean; data: TicketComment[] }>(`/tickets/${ticketId}/comments`);
    return res.data.data;
  },

  addComment: async (ticketId: string, payload: CreateCommentPayload): Promise<TicketComment> => {
    const res = await api.post<{ success: boolean; data: TicketComment }>(`/tickets/${ticketId}/comments`, payload);
    return res.data.data;
  },

  deleteComment: async (ticketId: string, commentId: string) => {
    const res = await api.delete<{ success: boolean; data: { deleted: boolean } }>(`/tickets/${ticketId}/comments/${commentId}`);
    return res.data;
  },
};
