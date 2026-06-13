import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/auth.store';

// ── Types ────────────────────────────────────────────────────────────────────

interface TenantSettings {
  id: string;
  slug?: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  timezone: string;
  language: string;
  email_confirmation?: boolean;
  away_message?: string;
  away_message_enabled?: boolean;
  csat_enabled?: boolean;
  csat_message?: string | null;
  csat_expiration_hours?: number;
  inactivity_enabled?: boolean;
  inactivity_warning_minutes?: number;
  inactivity_close_minutes?: number;
  inactivity_warning_message?: string;
  inactivity_close_message?: string;
  active_outbound_validity_mode?: 'end_of_day' | 'hours' | 'unlimited';
  active_outbound_validity_hours?: number;
  bot_assigned_message?: string;
  max_conversations_per_agent?: number | null;
  lgpd_retention_enabled?: boolean;
  lgpd_retention_days?: number;
  created_at?: string;
  plan?: {
    id: string;
    name: string;
    slug: string;
    priceMonth: string;
    features?: Record<string, unknown>;
  };
}

export interface MyProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  language: 'pt-BR' | 'en-US' | 'es' | string;
  notification_sound: boolean;
  notification_desktop: boolean;
  must_change_password: boolean;
  status: string;
  created_at: string;
}

export interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
  lgpd_consent_status?: 'pending' | 'granted' | 'denied' | 'revoked' | string;
  lgpd_consent_at?: string | null;
  lgpd_consent_source?: string | null;
  lgpd_last_export_at?: string | null;
  lgpd_anonymized_at?: string | null;
  lgpd_anonymization_reason?: string | null;
}

export interface UserLgpdRequest {
  id: string;
  user_id: string | null;
  user_name?: string | null;
  subject_type: string;
  request_type: 'access' | 'consent_update' | 'anonymization' | string;
  status: string;
  requested_by: string | null;
  requested_by_name?: string | null;
  processed_by: string | null;
  processed_by_name?: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  requested_at: string;
  processed_at: string | null;
}

export interface UserLgpdExportPayload {
  generated_at: string;
  request_id: string;
  user: TenantUser;
  tickets: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  audit_logs: Array<Record<string, unknown>>;
  lgpd_requests: UserLgpdRequest[];
}

export interface ProfileLgpdState {
  consent: {
    status: string;
    updated_at: string | null;
    source: string | null;
    last_export_at: string | null;
    anonymized_at: string | null;
  };
  requests: UserLgpdRequest[];
}

interface Channel {
  id: string;
  type: string;
  name: string;
  status: string;
  credentials?: Record<string, unknown>;
  settings: unknown;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  created_at: string;
}

export interface SmtpConfig {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromEmail: string;
  fromName: string | null;
  isActive: boolean;
  hasPassword: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface SmtpPayload {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  fromEmail: string;
  fromName?: string;
}

interface AdminStats {
  total_users: number;
  total_organizations: number;
  total_contacts: number;
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
  role: 'admin' | 'supervisor' | 'agent' | 'viewer';
}

export interface InviteUserResultData {
  user: TenantUser;
  emailSent: boolean;
  tempPassword?: string | null;
}

interface CreateChannelPayload {
  type: 'whatsapp' | 'instagram' | 'email' | 'webchat';
  name: string;
  credentials: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export type QuickReplyCategory =
  | 'greeting'
  | 'service'
  | 'commercial'
  | 'closing'
  | 'support'
  | 'other';

export interface QuickReply {
  id: string;
  title: string;
  shortcut: string;
  content: string;
  category: QuickReplyCategory;
  created_at: string;
  updated_at: string;
}

interface QuickRepliesListParams {
  search?: string;
  category?: QuickReplyCategory;
}

interface CreateQuickReplyPayload {
  title: string;
  shortcut: string;
  content: string;
  category: QuickReplyCategory;
}

interface UpdateChannelPayload {
  name?: string;
  credentials?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  status?: 'active' | 'inactive';
}

export interface BusinessHourShift {
  id: string;
  openTime: string;
  closeTime: string;
}

export interface BusinessHourDay {
  id: string;
  dayOfWeek: number;
  isActive: boolean;
  shifts: BusinessHourShift[];
}

export interface BusinessHoursHoliday {
  id: string;
  date: string;
  name: string;
  behavior: 'closed' | 'custom_hours';
  openTime: string | null;
  closeTime: string | null;
  isNational: boolean;
  country: string | null;
}

export interface BusinessHoursData {
  config: {
    is24x7: boolean;
  };
  days: BusinessHourDay[];
  holidays: BusinessHoursHoliday[];
}

export interface UpdateBusinessHoursPayload {
  is24x7?: boolean;
  days?: Array<{
    dayOfWeek: number;
    isActive: boolean;
    shifts: Array<{ openTime: string; closeTime: string }>;
  }>;
  holidays?: {
    add?: Array<{
      date: string;
      name: string;
      behavior: 'closed' | 'custom_hours';
      openTime?: string;
      closeTime?: string;
    }>;
    remove?: string[];
  };
}

export interface BusinessHoursStatus {
  is_open: boolean;
  next_open: string | null;
  next_open_day: number | null;
  next_open_time: string | null;
  closes_at: string | null;
}

export interface BotOption {
  id: string;
  bot_menu_id: string;
  number: number;
  label: string;
  tag: string | null;
  response: string | null;
  has_submenu: boolean;
  submenu_greeting: string | null;
  parent_option_id: string | null;
  sort_order: number;
  created_at: string;
  children?: BotOption[];
}

export interface BotMenu {
  id: string;
  is_active: boolean;
  greeting: string;
  footer: string | null;
  invalid_msg: string | null;
  created_at: string;
  updated_at: string;
  options: BotOption[];
}

export interface BotOptionPayload {
  number: number;
  label: string;
  tag?: string | null;
  response?: string | null;
  has_submenu?: boolean;
  submenu_greeting?: string | null;
  parent_option_id?: string | null;
  sort_order?: number;
}

export interface AutoAssignAgent {
  user_id: string;
  last_assigned_at: string;
  active_conversations: number;
  is_available: boolean;
  status: 'online' | 'paused' | 'offline' | string;
  pause_reason: string | null;
  pause_started_at: string | null;
  pause_notes: string | null;
  created_at: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: 'owner' | 'admin' | 'agent' | string;
}

export interface AutoAssignConfig {
  auto_assign: boolean;
  auto_assign_algorithm: 'round_robin';
  agents: AutoAssignAgent[];
}

export interface AgentPauseStatus {
  status: 'online' | 'paused' | 'offline' | string;
  pause_reason: string | null;
  pause_started_at: string | null;
  pause_notes: string | null;
  duration_seconds: number;
  is_available: boolean;
}

export interface PauseReason {
  id: string;
  label: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface TicketType {
  id: string;
  name: string;
  icon: string;
  color: string;
  is_active: boolean;
  sort_order: number;
  require_due_date_for_urgent: boolean;
  require_category_for_waiting: boolean;
  created_at: string;
  updated_at: string;
}

export interface VoiceConfig {
  id: string;
  tenantId: string;
  twilioPhoneNumber: string;
  defaultBotMenuId: string | null;
  ivrEnabled: boolean;
  ringTimeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateVoiceConfigPayload {
  twilioPhoneNumber: string;
  defaultBotMenuId?: string | null;
  ivrEnabled?: boolean;
  ringTimeoutSeconds?: number;
}

export interface TicketCategory {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationCloseConfigItem {
  id: string;
  label: string;
  isDefault: boolean;
  isActive: boolean;
  order: number;
  createdAt: string;
}

export interface ConversationCloseConfigPreview {
  types: Array<{ id: string; label: string }>;
  outcomes: Array<{ id: string; label: string }>;
}

export interface Skill {
  id: string;
  number: number;
  label: string;
  tag: string | null;
  has_submenu: boolean;
  parent_option_id: string | null;
  sort_order: number;
  agents_count: number;
  children?: Skill[];
}

export interface AgentSkill {
  bot_option_id: string;
  id: string;
  label: string;
  name: string;
  tag: string | null;
  parent_label: string | null;
  level: 'junior' | 'intermediate' | 'senior';
}

export interface AgentWithSkills {
  id: string;
  name: string;
  role: string;
  avatar_url: string | null;
  status: 'online' | 'paused' | 'offline' | string;
  is_available: boolean;
  active_conversations: number;
  max_conversations: number | null;
  pause_reason: string | null;
  pause_started_at: string | null;
  skills: AgentSkill[];
}

export interface MonitorData {
  agents: AgentWithSkills[];
  queue: {
    total: number;
    by_department: Record<string, number>;
  };
  active: {
    total: number;
    by_agent: Record<string, number>;
  };
  stats_today: {
    total_resolved: number;
    avg_resolution_minutes: number;
    total_messages: number;
  };
}

export interface TvAgentSummary {
  offline: number;
  online: number;
  available: number;
  inService: number;
  paused: number;
}

export interface TvConversationSummary {
  queued: number;
  inService: number;
  resolvedToday: number;
  abandoned: number;
}

export interface TvStatsSummary {
  tme: number;
  tma: number;
  csat: number;
  sla: number;
}

export interface TvAgentCard {
  id: string;
  name: string;
  avatarInitials: string;
  status: 'online' | 'paused' | 'offline';
  pauseReason: string | null;
  pauseStartedAt: string | null;
  pauseDuration: string | null;
  activeConversations: number;
  isAvailable: boolean;
}

export interface TvConversationCard {
  id: string;
  protocol: string;
  channelType: string;
  contactName: string;
  contactPhone: string;
  agentName: string | null;
  assignedAt: string | null;
  createdAt: string;
  status: string;
  waitTime: number | null;
  queueEnteredAt: string | null;
}

export interface TvDashboardData {
  agents: TvAgentSummary;
  conversations: TvConversationSummary;
  stats: TvStatsSummary;
  agentCards: TvAgentCard[];
  conversationCards: TvConversationCard[];
}

export interface MonitorBotConversation {
  id: string;
  contact_id: string | null;
  protocol_number: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  last_message: string | null;
  last_message_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  channel_name: string | null;
  channel_type: string;
  minutes_in_bot: number;
}

export interface MonitorBotData {
  conversations: MonitorBotConversation[];
  total: number;
  stuck: number;
}

export interface ConversationHelper {
  id: string;
  conversation_id: string;
  helper_user_id: string;
  helper_name: string | null;
  requested_by: string;
  requester_name: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'ended';
  created_at: string;
  accepted_at: string | null;
  ended_at: string | null;
}

export interface ConversationTag {
  id: string;
  name: string;
  color: string;
  is_active?: boolean;
  sort_order?: number;
  created_at?: string;
}

export interface ConversationTagAssignment extends ConversationTag {
  assigned_by?: string | null;
  assigned_at?: string;
}

// ── Admin API ─────────────────────────────────────────────────────────────────

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // envia httpOnly cookies (refresh_token)
  headers: {
    'Content-Type': 'application/json',
  },
});

const TOKEN_REFRESH_LEEWAY_SECONDS = 15;
let sharedRefreshPromise: Promise<string> | null = null;

interface JwtPayloadWithExp {
  exp?: number;
}

function decodeJwtPayload(token: string): JwtPayloadWithExp | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = atob(padded);
    return JSON.parse(json) as JwtPayloadWithExp;
  } catch {
    return null;
  }
}

function shouldProactivelyRefreshToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + TOKEN_REFRESH_LEEWAY_SECONDS;
}

function getDevImpersonatedTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isLocal) return null;
  return sessionStorage.getItem('impersonated_tenant_slug');
}

function shouldLogoutAfterRefreshFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 401 || status === 403;
}

async function refreshAccessToken(): Promise<string> {
  if (sharedRefreshPromise) return sharedRefreshPromise;

  sharedRefreshPromise = api
    .post<{ accessToken: string }>('/auth/refresh')
    .then(({ data }) => {
      const newToken = data.accessToken;
      useAuthStore.getState().setAuth({ token: newToken });
      return newToken;
    })
    .catch((error: unknown) => {
      if (shouldLogoutAfterRefreshFailure(error)) {
        useAuthStore.getState().logout();
      }
      throw error;
    })
    .finally(() => {
      sharedRefreshPromise = null;
    });

  return sharedRefreshPromise;
}

// Injeta o access token em cada requisição
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  let token = useAuthStore.getState().token;
  const isRefreshRequest = config.url?.includes('/auth/refresh') ?? false;

  if (token && !isRefreshRequest && shouldProactivelyRefreshToken(token)) {
    try {
      token = await refreshAccessToken();
    } catch (error) {
      if (shouldLogoutAfterRefreshFailure(error)) {
        throw error;
      }
      // Em falhas transitórias (ex: 429), mantém token atual para não derrubar sessão.
    }
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const impersonatedTenantSlug = getDevImpersonatedTenantSlug();
  if (impersonatedTenantSlug) {
    config.headers['X-Tenant-Slug'] = impersonatedTenantSlug;
  }

  // Deixa o browser definir o boundary automaticamente para multipart/form-data
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    const headers = config.headers as Record<string, unknown>;
    delete headers['Content-Type'];
  }

  return config;
});

// Interceptor de resposta: tenta refresh automático em 401
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (!original) return Promise.reject(error);

    // Só tenta refresh uma vez e apenas para rotas que não sejam de auth
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/auth/')
    ) {
      return Promise.reject(error);
    }

    original._retry = true;

    try {
      const newToken = await refreshAccessToken();
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  },
);

// ── CRM Types ─────────────────────────────────────────────────────────────────

export interface CrmOrganization {
  id: string;
  type: 'company' | 'person';
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: 'lead' | 'prospect' | 'client' | 'inactive';
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  segment: string | null;
  lead_source: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  notes: string | null;
  contacts_count: number;
  conversations_count: number;
  tickets_count: number;
  created_at: string;
  updated_at: string;
}

export interface CrmContact {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  organization_status?: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  document: string | null;
  role: string | null;
  department: string | null;
  is_primary: boolean;
  avatar_url: string | null;
  portal_enabled?: boolean;
  portal_last_login?: string | null;
  portal_invited_at?: string | null;
  lgpd_consent_status?: 'pending' | 'granted' | 'denied' | 'revoked' | string;
  lgpd_consent_at?: string | null;
  lgpd_consent_source?: string | null;
  lgpd_last_export_at?: string | null;
  lgpd_anonymized_at?: string | null;
  lgpd_anonymization_reason?: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactTag {
  id: string;
  name: string;
  color: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export type ContactImportFormat = 'csv' | 'xlsx' | 'vcf';
export type ContactImportDuplicateAction = 'skip' | 'update';

export interface ContactImportPreview {
  importId: string;
  format: ContactImportFormat;
  totalRows: number;
  columns: string[];
  preview: Array<Record<string, string>>;
}

export interface ContactImportMapping {
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  organization_name?: string;
  role?: string;
  department?: string;
  tags?: string;
  custom_fields?: string;
}

export interface ContactImportResult {
  jobId: string;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface LgpdRequest {
  id: string;
  contact_id: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_document?: string | null;
  request_type: 'access' | 'consent_update' | 'anonymization' | string;
  status: string;
  requested_by: string | null;
  requested_by_name?: string | null;
  processed_by: string | null;
  processed_by_name?: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  requested_at: string;
  processed_at: string | null;
}

export interface LgpdExportPayload {
  generated_at: string;
  request_id: string;
  contact: CrmContact;
  organization: Record<string, unknown> | null;
  conversations: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  lgpd_requests: LgpdRequest[];
}

export interface CrmOrganizationStats {
  total_contacts: number;
  total_conversations: number;
  open_conversations: number;
  total_tickets: number;
  open_tickets: number;
  last_contact_at: string | null;
}

export interface CrmOrganizationConversation {
  id: string;
  status: string;
  channel_type: string | null;
  protocol: string | null;
  subject: string | null;
  bot_department: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
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

interface ListOrganizationsParams {
  page?: number;
  per_page?: number;
  search?: string;
  status?: string;
  segment?: string;
  responsible_id?: string;
  tag?: string;
  sort_by?: 'name' | 'created_at' | 'updated_at';
  sort_order?: 'asc' | 'desc';
}

interface ListContactsParams {
  page?: number;
  per_page?: number;
  organization_id?: string;
  search?: string;
  standalone_only?: boolean;
  tags?: string[];
  status?: 'lead' | 'prospect' | 'client' | 'inactive';
}

export interface CrmBulkDeleteResult {
  requested: number;
  deleted: string[];
  blocked: Array<{ id: string; reason: string }>;
  not_found: string[];
}

// ── CRM API ───────────────────────────────────────────────────────────────────

export const organizationsApi = {
  list: async (params?: ListOrganizationsParams): Promise<{ data: CrmOrganization[]; meta: CrmListMeta }> => {
    const res = await api.get<{ success: boolean; data: CrmOrganization[]; meta: CrmListMeta }>('/crm/organizations', { params });
    return { data: res.data.data, meta: res.data.meta };
  },
  get: async (id: string): Promise<CrmOrganization> => {
    const res = await api.get<{ success: boolean; data: CrmOrganization }>(`/crm/organizations/${id}`);
    return res.data.data;
  },
  create: async (payload: Partial<CrmOrganization>): Promise<CrmOrganization> => {
    const res = await api.post<{ success: boolean; data: CrmOrganization }>('/crm/organizations', payload);
    return res.data.data;
  },
  update: async (id: string, payload: Partial<CrmOrganization>): Promise<CrmOrganization> => {
    const res = await api.patch<{ success: boolean; data: CrmOrganization }>(`/crm/organizations/${id}`, payload);
    return res.data.data;
  },
  delete: async (id: string) => api.delete(`/crm/organizations/${id}`),
  bulkDelete: async (ids: string[]): Promise<CrmBulkDeleteResult> => {
    const res = await api.post<{ success: boolean; data: CrmBulkDeleteResult }>(
      '/crm/organizations/bulk-delete',
      { ids },
    );
    return res.data.data;
  },
  getStats: async (id: string): Promise<CrmOrganizationStats> => {
    const res = await api.get<{ success: boolean; data: CrmOrganizationStats }>(`/crm/organizations/${id}/stats`);
    return res.data.data;
  },
  getContacts: async (id: string): Promise<CrmContact[]> => {
    const res = await api.get<{ success: boolean; data: CrmContact[] }>(`/crm/organizations/${id}/contacts`);
    return res.data.data;
  },
  getConversations: async (id: string): Promise<{ success: boolean; data: CrmOrganizationConversation[] }> => {
    const res = await api.get<{ success: boolean; data: CrmOrganizationConversation[] }>(`/crm/organizations/${id}/conversations`);
    return res.data;
  },
  getTickets: async (id: string) => {
    const res = await api.get(`/crm/organizations/${id}/tickets`);
    return res.data;
  },
  revealPii: async (id: string): Promise<CrmOrganization> => {
    const res = await api.post<{ success: boolean; data: CrmOrganization }>(`/crm/organizations/${id}/pii/reveal`);
    return res.data.data;
  },
};

export const contactsApi = {
  list: async (params?: ListContactsParams): Promise<{ data: CrmContact[]; meta: CrmListMeta }> => {
    const { tags, ...rest } = params ?? {};
    const res = await api.get<{ success: boolean; data: CrmContact[]; meta: CrmListMeta }>('/crm/contacts', {
      params: {
        ...rest,
        ...(tags?.length ? { tags: tags.join(',') } : {}),
      },
    });
    return { data: res.data.data, meta: res.data.meta };
  },
  listTags: async (): Promise<ContactTag[]> => {
    const res = await api.get<{ success: boolean; data: ContactTag[] }>('/crm/contacts/tags');
    return res.data.data;
  },
  getTags: async (id: string): Promise<ContactTag[]> => {
    const res = await api.get<{ success: boolean; data: ContactTag[] }>(`/crm/contacts/${id}/tags`);
    return res.data.data;
  },
  addTag: async (id: string, tagId: string): Promise<{ contact_id: string; tag_id: string }> => {
    const res = await api.post<{
      success: boolean;
      data: { contact_id: string; tag_id: string };
    }>(`/crm/contacts/${id}/tags`, { tag_id: tagId });
    return res.data.data;
  },
  removeTag: async (id: string, tagId: string): Promise<{ removed: boolean }> => {
    const res = await api.delete<{ success: boolean; data: { removed: boolean } }>(
      `/crm/contacts/${id}/tags/${tagId}`,
    );
    return res.data.data;
  },
  get: async (id: string): Promise<CrmContact> => {
    const res = await api.get<{ success: boolean; data: CrmContact }>(`/crm/contacts/${id}`);
    return res.data.data;
  },
  getStats: async (id: string): Promise<{
    total_conversations: number;
    total_messages: number;
    open_tickets: number;
  }> => {
    const res = await api.get<{
      success: boolean;
      data: { total_conversations: number; total_messages: number; open_tickets: number };
    }>(`/crm/contacts/${id}/stats`);
    return res.data.data;
  },
  create: async (payload: Partial<CrmContact> & { tag_ids?: string[] }): Promise<CrmContact> => {
    const res = await api.post<{ success: boolean; data: CrmContact }>('/crm/contacts', payload);
    return res.data.data;
  },
  previewImport: async (file: File): Promise<ContactImportPreview> => {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post<{ success: boolean; data: ContactImportPreview }>('/crm/contacts/import/preview', form);
    return res.data.data;
  },
  confirmImport: async (payload: {
    importId: string;
    mapping: ContactImportMapping;
    duplicateAction: ContactImportDuplicateAction;
  }): Promise<{ jobId: string; message: string }> => {
    const res = await api.post<{ success: boolean; data: { jobId: string; message: string } }>(
      '/crm/contacts/import/confirm',
      payload,
    );
    return res.data.data;
  },
  update: async (
    id: string,
    payload: Partial<CrmContact> & { tag_ids?: string[] },
  ): Promise<CrmContact> => {
    const res = await api.patch<{ success: boolean; data: CrmContact }>(`/crm/contacts/${id}`, payload);
    return res.data.data;
  },
  delete: async (id: string) => api.delete(`/crm/contacts/${id}`),
  bulkDelete: async (ids: string[]): Promise<CrmBulkDeleteResult> => {
    const res = await api.post<{ success: boolean; data: CrmBulkDeleteResult }>(
      '/crm/contacts/bulk-delete',
      { ids },
    );
    return res.data.data;
  },
  linkOrganization: async (id: string, organization_id: string) =>
    api.post(`/crm/contacts/${id}/link-organization`, { organization_id }),
  listLgpdRequests: async (params?: {
    page?: number;
    per_page?: number;
    contact_id?: string;
    request_type?: 'access' | 'consent_update' | 'anonymization' | 'rectification';
    status?: string;
  }): Promise<{ data: LgpdRequest[]; meta: CrmListMeta }> => {
    const res = await api.get<{ success: boolean; data: LgpdRequest[]; meta: CrmListMeta }>(
      '/crm/contacts/lgpd/requests',
      { params },
    );
    return { data: res.data.data, meta: res.data.meta };
  },
  updateLgpdConsent: async (
    id: string,
    payload: { status: 'pending' | 'granted' | 'denied' | 'revoked'; source?: string },
  ): Promise<{ contact: CrmContact; request: LgpdRequest }> => {
    const res = await api.patch<{ success: boolean; data: { contact: CrmContact; request: LgpdRequest } }>(
      `/crm/contacts/${id}/lgpd/consent`,
      payload,
    );
    return res.data.data;
  },
  exportLgpdData: async (
    id: string,
    params?: { include_messages?: boolean },
  ): Promise<LgpdExportPayload> => {
    const res = await api.get<{ success: boolean; data: LgpdExportPayload }>(
      `/crm/contacts/${id}/lgpd/export`,
      { params },
    );
    return res.data.data;
  },
  anonymizeLgpd: async (
    id: string,
    payload?: { reason?: string; redact_messages?: boolean },
  ): Promise<{ contact: CrmContact; request: LgpdRequest; summary: { conversations_updated: number; messages_redacted: number } }> => {
    const res = await api.post<{
      success: boolean;
      data: {
        contact: CrmContact;
        request: LgpdRequest;
        summary: { conversations_updated: number; messages_redacted: number };
      };
    }>(`/crm/contacts/${id}/lgpd/anonymize`, payload);
    return res.data.data;
  },
  approveLgpdRequest: async (id: string): Promise<{ id: string; status: string; contact: CrmContact }> => {
    const res = await api.post<{ success: boolean; data: { id: string; status: string; contact: CrmContact } }>(
      `/crm/contacts/lgpd/requests/${id}/approve`,
    );
    return res.data.data;
  },
  rejectLgpdRequest: async (id: string, payload: { reason: string }): Promise<{ id: string; status: string }> => {
    const res = await api.post<{ success: boolean; data: { id: string; status: string } }>(
      `/crm/contacts/lgpd/requests/${id}/reject`,
      payload,
    );
    return res.data.data;
  },
  portalAccess: {
    create: async (contactId: string): Promise<{
      temp_password: string;
      portal_url: string;
      email: string | null;
    }> => {
      const res = await api.post<{
        success: boolean;
        data: { temp_password: string; portal_url: string; email: string | null };
      }>(`/crm/contacts/${contactId}/portal-access`);
      return res.data.data;
    },
    revoke: async (contactId: string): Promise<{ revoked: boolean }> => {
      const res = await api.delete<{ success: boolean; data: { revoked: boolean } }>(
        `/crm/contacts/${contactId}/portal-access`,
      );
      return res.data.data;
    },
  },
  revealPii: async (contactId: string): Promise<CrmContact> => {
    const res = await api.post<{ success: boolean; data: CrmContact }>(`/crm/contacts/${contactId}/pii/reveal`);
    return res.data.data;
  },
};

// ── Admin API ─────────────────────────────────────────────────────────────────

export interface AIAgentConfig {
  id: string;
  is_enabled: boolean;
  agent_name: string;
  system_prompt: string | null;
  fallback_skill_id: string | null;
  max_attempts: number;
  confidence_threshold: number;
  openai_api_key: string | null;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  source_type: 'manual' | 'url' | 'file';
  source_url: string | null;
  file_name: string | null;
  status: 'processing' | 'indexed' | 'error';
  error_message: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  chunk_count: number;
}

export type WebhookEvent =
  | 'ticket.created' | 'ticket.updated' | 'ticket.resolved' | 'ticket.closed'
  | 'conversation.created' | 'conversation.resolved' | 'conversation.assigned'
  | 'contact.created' | 'contact.updated';

export interface OutboundWebhook {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  events: WebhookEvent[];
  headers: Record<string, string>;
  is_active: boolean;
  last_triggered_at: string | null;
  last_status: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWebhookPayload {
  name: string;
  url: string;
  secret?: string;
  events: WebhookEvent[];
  headers?: Record<string, string>;
  isActive: boolean;
}

export interface RedmineIntegrationConfig {
  id: string;
  name: string;
  redmine_url: string;
  project_id: string;
  is_active: boolean;
  sync_comments: boolean;
  sync_status: boolean;
  sync_company: boolean;
  status_map: Record<string, number>;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
  has_api_key: boolean;
  api_key_masked: string | null;
}

export interface SaveRedmineIntegrationPayload {
  name?: string;
  redmineUrl: string;
  apiKey: string;
  projectId: string;
  isActive?: boolean;
  syncComments?: boolean;
  syncStatus?: boolean;
  syncCompany?: boolean;
  statusMap?: Record<string, number>;
}

export interface UpdateRedmineIntegrationPayload {
  name?: string;
  redmineUrl?: string;
  apiKey?: string;
  projectId?: string;
  isActive?: boolean;
  syncComments?: boolean;
  syncStatus?: boolean;
  syncCompany?: boolean;
  statusMap?: Record<string, number>;
}

export type WhatsAppTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type WhatsAppTemplateLanguage = 'pt_BR' | 'en_US' | 'es';
export type WhatsAppTemplateStatus =
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'paused'
  | 'disabled'
  | 'in_appeal'
  | 'pending_deletion';
export type WhatsAppTemplateHeaderType = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
export type WhatsAppTemplateInputHeaderType = 'none' | 'text' | 'image' | 'video' | 'document';

export interface WhatsAppTemplateVariable {
  index: string;
  example: string;
}

export interface WhatsAppTemplateButtonQuickReply {
  type: 'QUICK_REPLY';
  text: string;
}

export interface WhatsAppTemplateButtonUrl {
  type: 'URL';
  text: string;
  url: string;
  example?: string[];
}

export interface WhatsAppTemplateButtonPhone {
  type: 'PHONE_NUMBER';
  text: string;
  phone_number: string;
}

export type WhatsAppTemplateButton =
  | WhatsAppTemplateButtonQuickReply
  | WhatsAppTemplateButtonUrl
  | WhatsAppTemplateButtonPhone;

export interface WhatsAppTemplate {
  id: string;
  channel_id: string;
  name: string;
  display_name: string;
  language: WhatsAppTemplateLanguage;
  category: WhatsAppTemplateCategory;
  body: string;
  header: string | null;
  header_type: WhatsAppTemplateHeaderType;
  header_example_url: string | null;
  footer: string | null;
  variables: WhatsAppTemplateVariable[];
  components: Array<Record<string, unknown>>;
  buttons: Array<Record<string, unknown>>;
  status: WhatsAppTemplateStatus;
  meta_template_id: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWhatsAppTemplatePayload {
  channelId: string;
  technicalName: string;
  displayName: string;
  language: WhatsAppTemplateLanguage;
  category: WhatsAppTemplateCategory;
  body: string;
  headerType: WhatsAppTemplateInputHeaderType;
  headerText?: string;
  headerHandle?: string;
  footer?: string;
  variables?: WhatsAppTemplateVariable[];
  buttons?: WhatsAppTemplateButton[];
}

export interface UpdateWhatsAppTemplatePayload {
  channelId?: string;
  technicalName?: string;
  displayName?: string;
  language?: WhatsAppTemplateLanguage;
  category?: WhatsAppTemplateCategory;
  body?: string;
  headerType?: WhatsAppTemplateInputHeaderType;
  headerText?: string;
  headerHandle?: string;
  footer?: string;
  variables?: WhatsAppTemplateVariable[];
  buttons?: WhatsAppTemplateButton[];
}

export interface WhatsAppTemplateMediaUpload {
  header_handle: string;
  mime_type: string;
  filename: string;
}

interface QueueConfigSettings {
  queue_notifications_enabled: boolean;
  queue_message_template: string;
  queue_throttle_seconds: number;
  agent_assume_template: string;
  expire_24h_action: 'close' | 'keep_open';
  expire_24h_message: string;
}

export const adminApi = {
  getStats: async (): Promise<AdminStats> => {
    const res = await api.get<{ success: boolean; data: AdminStats }>('/admin/stats/overview');
    return res.data.data;
  },

  getSettings: async (): Promise<TenantSettings> => {
    const res = await api.get<{ success: boolean; data: TenantSettings }>('/admin/settings');
    return res.data.data;
  },

  updateSettings: async (data: Partial<TenantSettings>): Promise<TenantSettings> => {
    const res = await api.patch<{ success: boolean; data: TenantSettings }>('/admin/settings', data);
    return res.data.data;
  },

  uploadSettingsLogo: async (file: File): Promise<{ logo_url: string }> => {
    const form = new FormData();
    form.append('logo', file);
    const res = await api.post<{ success: boolean; data: { logo_url: string } }>(
      '/admin/settings/logo',
      form,
    );
    return res.data.data;
  },

  getQueueConfig: async () => {
    const res = await api.get<{ success: boolean; data: QueueConfigSettings }>('/admin/queue-config');
    return res.data.data;
  },

  updateQueueConfig: async (data: Partial<QueueConfigSettings>) => {
    const res = await api.patch<{ success: boolean; data: QueueConfigSettings }>('/admin/queue-config', data);
    return res.data.data;
  },

  autoAssign: {
    getConfig: async (): Promise<AutoAssignConfig> => {
      const res = await api.get<{ success: boolean; data: AutoAssignConfig }>('/admin/auto-assign');
      return res.data.data;
    },

    updateConfig: async (data: { auto_assign?: boolean; auto_assign_algorithm?: 'round_robin' }) => {
      const res = await api.patch<{
        success: boolean;
        data: { auto_assign: boolean; auto_assign_algorithm: 'round_robin' };
      }>('/admin/auto-assign', data);
      return res.data.data;
    },

    toggleAgent: async (userId: string, data: { is_available: boolean }) => {
      const res = await api.patch<{ success: boolean; data: AutoAssignAgent }>(
        `/admin/auto-assign/agents/${userId}`,
        data,
      );
      return res.data.data;
    },

    reset: async () => {
      await api.post('/admin/auto-assign/reset');
    },

    setAvailability: async (data: { is_available: boolean }) => {
      const res = await api.put<{ success: boolean; data: AutoAssignAgent }>('/omnichannel/availability', data);
      return res.data.data;
    },
  },

  listUsers: async (params?: ListUsersParams): Promise<PaginatedUsers> => {
    const res = await api.get<{ success: boolean } & PaginatedUsers>('/admin/users', { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  inviteUser: async (payload: InviteUserPayload) => {
    const res = await api.post<{ success: boolean; data: InviteUserResultData }>(
      '/admin/users/invite',
      payload,
    );
    return res.data;
  },

  updateUser: async (id: string, payload: { name?: string; role?: string; status?: string; max_conversations?: number | null }) => {
    const res = await api.patch<{ success: boolean; data: TenantUser }>(`/admin/users/${id}`, payload);
    return res.data;
  },

  deleteUser: async (id: string) => {
    const res = await api.delete<{ success: boolean; data: TenantUser }>(`/admin/users/${id}`);
    return res.data;
  },

  resetUserPassword: async (id: string) => {
    const res = await api.post<{ success: boolean; data: { message: string } }>(`/admin/users/${id}/reset-password`);
    return res.data;
  },

  listUserLgpdRequests: async (params?: {
    page?: number; per_page?: number; user_id?: string;
    request_type?: string; status?: string;
  }): Promise<{ data: UserLgpdRequest[]; meta: { total: number; page: number; per_page: number; total_pages: number } }> => {
    const res = await api.get<{ success: boolean; data: UserLgpdRequest[]; meta: { total: number; page: number; per_page: number; total_pages: number } }>(
      '/admin/users/lgpd/requests',
      { params },
    );
    return { data: res.data.data, meta: res.data.meta };
  },

  updateUserLgpdConsent: async (id: string, payload: { status: string; source?: string }): Promise<{ user: TenantUser; request: UserLgpdRequest }> => {
    const res = await api.patch<{ success: boolean; data: { user: TenantUser; request: UserLgpdRequest } }>(
      `/admin/users/${id}/lgpd/consent`,
      payload,
    );
    return res.data.data;
  },

  exportUserLgpdData: async (id: string, params?: { include_audit_logs?: boolean }): Promise<UserLgpdExportPayload> => {
    const res = await api.get<{ success: boolean; data: UserLgpdExportPayload }>(
      `/admin/users/${id}/lgpd/export`,
      { params },
    );
    return res.data.data;
  },

  anonymizeUserLgpd: async (id: string, payload: { reason?: string }): Promise<{ user: TenantUser; request: UserLgpdRequest }> => {
    const res = await api.post<{ success: boolean; data: { user: TenantUser; request: UserLgpdRequest } }>(
      `/admin/users/${id}/lgpd/anonymize`,
      payload,
    );
    return res.data.data;
  },

  anonymizeByExternalId: async (payload: {
    external_id: string;
    reason: string;
  }): Promise<{ request_id: string; summary: { conversations_anonymized: number; messages_redacted: number } }> => {
    const res = await api.post<{
      success: boolean;
      data: { request_id: string; summary: { conversations_anonymized: number; messages_redacted: number } };
    }>('/admin/omnichannel/conversations/anonymize-by-external-id', payload);
    return res.data.data;
  },

  listExternalLgpdRequests: async (params?: {
    page?: number;
    per_page?: number;
    status?: string;
  }): Promise<{
    data: Array<{
      id: string;
      subject_type: string;
      request_type: string;
      status: string;
      requested_by: string | null;
      requested_by_name: string | null;
      payload: Record<string, unknown>;
      result: Record<string, unknown>;
      requested_at: string;
      processed_at: string | null;
    }>;
    meta: { total: number; page: number; per_page: number; total_pages: number };
  }> => {
    const res = await api.get<{
      success: boolean;
      data: Array<{
        id: string;
        subject_type: string;
        request_type: string;
        status: string;
        requested_by: string | null;
        requested_by_name: string | null;
        payload: Record<string, unknown>;
        result: Record<string, unknown>;
        requested_at: string;
        processed_at: string | null;
      }>;
      meta: { total: number; page: number; per_page: number; total_pages: number };
    }>('/admin/omnichannel/conversations/external-requests', { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  getLgpdDashboard: async (): Promise<{
    total_pending: number;
    expiring_7d: number;
    expiring_24h: number;
    breached: number;
    oldest_pending: Array<{
      id: string;
      subject_type: string;
      request_type: string;
      status: string;
      requested_at: string;
      sla_deadline: string | null;
      subject_label: string;
    }>;
  }> => {
    const res = await api.get<{ success: boolean; data: {
      total_pending: number;
      expiring_7d: number;
      expiring_24h: number;
      breached: number;
      oldest_pending: Array<{
        id: string;
        subject_type: string;
        request_type: string;
        status: string;
        requested_at: string;
        sla_deadline: string | null;
        subject_label: string;
      }>;
    } }>('/admin/lgpd/dashboard');
    return res.data.data;
  },

  processLgpdRequest: async (id: string, payload: { action: 'approve' | 'reject'; notes?: string | undefined }): Promise<{ id: string; status: string }> => {
    const res = await api.patch<{ success: boolean; data: { id: string; status: string } }>(`/admin/lgpd/requests/${id}`, payload);
    return res.data.data;
  },

  listChannels: async (): Promise<Channel[]> => {
    const res = await api.get<{ success: boolean; data: Channel[] }>('/admin/channels');
    return res.data.data;
  },

  listChannelsByTypes: async (types: string[]): Promise<Channel[]> => {
    const query = types.length ? { types: types.join(',') } : undefined;
    const res = await api.get<{ success: boolean; data: Channel[] }>('/admin/channels', { params: query });
    return res.data.data;
  },

  getChannel: async (id: string): Promise<Channel> => {
    const res = await api.get<{ success: boolean; data: Channel }>(`/admin/channels/${id}`);
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

  smtp: {
    get: async (): Promise<SmtpConfig | null> => {
      const res = await api.get<{ success: boolean; data: SmtpConfig | null }>('/admin/smtp');
      return res.data.data;
    },

    save: async (payload: SmtpPayload): Promise<SmtpConfig> => {
      const res = await api.post<{ success: boolean; data: SmtpConfig }>('/admin/smtp', payload);
      return res.data.data;
    },

    update: async (payload: SmtpPayload): Promise<SmtpConfig> => {
      const res = await api.patch<{ success: boolean; data: SmtpConfig }>('/admin/smtp', payload);
      return res.data.data;
    },

    remove: async (): Promise<{ deleted: boolean }> => {
      const res = await api.delete<{ success: boolean; data: { deleted: boolean } }>('/admin/smtp');
      return res.data.data;
    },

    test: async (payload: Partial<SmtpPayload>): Promise<{ message: string }> => {
      const res = await api.post<{ success: boolean; message: string }>('/admin/smtp/test', payload);
      return { message: res.data.message };
    },
  },

  businessHours: {
    list: async (): Promise<BusinessHoursData> => {
      const res = await api.get<{ success: boolean; data: BusinessHoursData }>('/admin/business-hours');
      return res.data.data;
    },

    update: async (data: UpdateBusinessHoursPayload): Promise<BusinessHoursData> => {
      const res = await api.patch<{ success: boolean; data: BusinessHoursData }>(
        '/admin/business-hours',
        data,
      );
      return res.data.data;
    },

    importNationalHolidays: async (country: 'BR' | 'US' | 'PT' | 'AR'): Promise<{ imported: number }> => {
      const res = await api.post<{ success: boolean; data: { imported: number } }>(
        '/admin/business-hours/holidays/import',
        { country },
      );
      return res.data.data;
    },

    getStatus: async (): Promise<BusinessHoursStatus> => {
      const res = await api.get<{ success: boolean; data: BusinessHoursStatus }>(
        '/admin/business-hours/status',
      );
      return res.data.data;
    },

    updateSettings: async (data: Partial<TenantSettings>): Promise<TenantSettings> => {
      const res = await api.patch<{ success: boolean; data: TenantSettings }>('/admin/settings', data);
      return res.data.data;
    },
  },

  voiceConfig: {
    get: async (): Promise<VoiceConfig | null> => {
      const res = await api.get<{ success: boolean; data: VoiceConfig | null }>('/admin/voice-config');
      return res.data.data;
    },

    update: async (data: UpdateVoiceConfigPayload): Promise<VoiceConfig> => {
      const res = await api.patch<{ success: boolean; data: VoiceConfig }>('/admin/voice-config', data);
      return res.data.data;
    },
  },

  bot: {
    getMenu: async (): Promise<BotMenu> => {
      const res = await api.get<{ success: boolean; data: BotMenu }>('/admin/bot');
      return res.data.data;
    },

    updateMenu: async (data: Partial<Pick<BotMenu, 'is_active' | 'greeting' | 'footer' | 'invalid_msg'>>): Promise<BotMenu> => {
      const res = await api.patch<{ success: boolean; data: BotMenu }>('/admin/bot', data);
      return res.data.data;
    },

    addOption: async (data: BotOptionPayload): Promise<BotOption> => {
      const res = await api.post<{ success: boolean; data: BotOption }>('/admin/bot/options', data);
      return res.data.data;
    },

    addSubOption: async (parentId: string, data: BotOptionPayload): Promise<BotOption> => {
      const res = await api.post<{ success: boolean; data: BotOption }>(
        `/admin/bot/options/${parentId}/sub`,
        data,
      );
      return res.data.data;
    },

    getOptionWithChildren: async (id: string): Promise<BotOption> => {
      const res = await api.get<{ success: boolean; data: BotOption }>(`/admin/bot/options/${id}`);
      return res.data.data;
    },

    updateOption: async (id: string, data: Partial<BotOptionPayload>): Promise<BotOption> => {
      const res = await api.patch<{ success: boolean; data: BotOption }>(`/admin/bot/options/${id}`, data);
      return res.data.data;
    },

    deleteOption: async (id: string): Promise<BotOption> => {
      const res = await api.delete<{ success: boolean; data: BotOption }>(`/admin/bot/options/${id}`, {
        data: {},
      });
      return res.data.data;
    },
  },

  pauseReasons: {
    list: async (): Promise<PauseReason[]> => {
      const res = await api.get<{ success: boolean; data: PauseReason[] }>('/admin/pause-reasons');
      return res.data.data;
    },

    create: async (data: { label: string; icon?: string; sort_order?: number }): Promise<PauseReason> => {
      const res = await api.post<{ success: boolean; data: PauseReason }>('/admin/pause-reasons', data);
      return res.data.data;
    },

    update: async (
      id: string,
      data: Partial<{ label: string; icon: string; sort_order: number; is_active: boolean }>,
    ): Promise<PauseReason> => {
      const res = await api.patch<{ success: boolean; data: PauseReason }>(`/admin/pause-reasons/${id}`, data);
      return res.data.data;
    },

    delete: async (id: string): Promise<PauseReason> => {
      const res = await api.delete<{ success: boolean; data: PauseReason }>(`/admin/pause-reasons/${id}`);
      return res.data.data;
    },
  },

  ticketTypes: {
    list: async (): Promise<TicketType[]> => {
      const res = await api.get<{ success: boolean; data: TicketType[] }>('/admin/ticket-types');
      return res.data.data;
    },

    create: async (data: {
      name: string;
      icon?: string;
      color?: string;
      sort_order?: number;
      require_due_date_for_urgent?: boolean;
      require_category_for_waiting?: boolean;
    }): Promise<TicketType> => {
      const res = await api.post<{ success: boolean; data: TicketType }>('/admin/ticket-types', data);
      return res.data.data;
    },

    update: async (
      id: string,
      data: Partial<{
        name: string;
        icon: string;
        color: string;
        sort_order: number;
        is_active: boolean;
        require_due_date_for_urgent: boolean;
        require_category_for_waiting: boolean;
      }>,
    ): Promise<TicketType> => {
      const res = await api.patch<{ success: boolean; data: TicketType }>(`/admin/ticket-types/${id}`, data);
      return res.data.data;
    },

    delete: async (id: string): Promise<TicketType> => {
      const res = await api.delete<{ success: boolean; data: TicketType }>(`/admin/ticket-types/${id}`);
      return res.data.data;
    },
  },

  ticketCategories: {
    list: async (): Promise<TicketCategory[]> => {
      const res = await api.get<{ success: boolean; data: TicketCategory[] }>('/admin/ticket-categories');
      return res.data.data;
    },

    create: async (data: {
      name: string;
      description?: string;
      color?: string;
      is_active?: boolean;
      sort_order?: number;
    }): Promise<TicketCategory> => {
      const res = await api.post<{ success: boolean; data: TicketCategory }>('/admin/ticket-categories', data);
      return res.data.data;
    },

    update: async (
      id: string,
      data: Partial<{
        name: string;
        description: string;
        color: string | null;
        is_active: boolean;
        sort_order: number;
      }>,
    ): Promise<TicketCategory> => {
      const res = await api.patch<{ success: boolean; data: TicketCategory }>(`/admin/ticket-categories/${id}`, data);
      return res.data.data;
    },

    delete: async (id: string): Promise<TicketCategory> => {
      const res = await api.delete<{ success: boolean; data: TicketCategory }>(`/admin/ticket-categories/${id}`);
      return res.data.data;
    },
  },

  closeConfig: {
    listTypes: async (): Promise<ConversationCloseConfigItem[]> => {
      const res = await api.get<{ success: boolean; data: ConversationCloseConfigItem[] }>(
        '/admin/close-config/types',
      );
      return res.data.data;
    },

    createType: async (data: { label: string; isActive?: boolean; order?: number }): Promise<ConversationCloseConfigItem> => {
      const res = await api.post<{ success: boolean; data: ConversationCloseConfigItem }>(
        '/admin/close-config/types',
        data,
      );
      return res.data.data;
    },

    updateType: async (
      id: string,
      data: Partial<{ label: string; isActive: boolean; order: number }>,
    ): Promise<ConversationCloseConfigItem> => {
      const res = await api.patch<{ success: boolean; data: ConversationCloseConfigItem }>(
        `/admin/close-config/types/${id}`,
        data,
      );
      return res.data.data;
    },

    deleteType: async (id: string): Promise<ConversationCloseConfigItem> => {
      const res = await api.delete<{ success: boolean; data: ConversationCloseConfigItem }>(
        `/admin/close-config/types/${id}`,
      );
      return res.data.data;
    },

    reorderTypes: async (ids: string[]): Promise<ConversationCloseConfigItem[]> => {
      const res = await api.patch<{ success: boolean; data: ConversationCloseConfigItem[] }>(
        '/admin/close-config/types/reorder',
        { ids },
      );
      return res.data.data;
    },

    listOutcomes: async (): Promise<ConversationCloseConfigItem[]> => {
      const res = await api.get<{ success: boolean; data: ConversationCloseConfigItem[] }>(
        '/admin/close-config/outcomes',
      );
      return res.data.data;
    },

    createOutcome: async (data: { label: string; isActive?: boolean; order?: number }): Promise<ConversationCloseConfigItem> => {
      const res = await api.post<{ success: boolean; data: ConversationCloseConfigItem }>(
        '/admin/close-config/outcomes',
        data,
      );
      return res.data.data;
    },

    updateOutcome: async (
      id: string,
      data: Partial<{ label: string; isActive: boolean; order: number }>,
    ): Promise<ConversationCloseConfigItem> => {
      const res = await api.patch<{ success: boolean; data: ConversationCloseConfigItem }>(
        `/admin/close-config/outcomes/${id}`,
        data,
      );
      return res.data.data;
    },

    deleteOutcome: async (id: string): Promise<ConversationCloseConfigItem> => {
      const res = await api.delete<{ success: boolean; data: ConversationCloseConfigItem }>(
        `/admin/close-config/outcomes/${id}`,
      );
      return res.data.data;
    },

    reorderOutcomes: async (ids: string[]): Promise<ConversationCloseConfigItem[]> => {
      const res = await api.patch<{ success: boolean; data: ConversationCloseConfigItem[] }>(
        '/admin/close-config/outcomes/reorder',
        { ids },
      );
      return res.data.data;
    },
  },

  skills: {
    list: async (): Promise<Skill[]> => {
      const res = await api.get<{ success: boolean; data: Skill[] }>('/admin/skills');
      return res.data.data;
    },

    listAgents: async (): Promise<AgentWithSkills[]> => {
      const res = await api.get<{ success: boolean; data: AgentWithSkills[] }>('/admin/skills/agents');
      return res.data.data;
    },

    getAgentSkills: async (userId: string): Promise<AgentSkill[]> => {
      const res = await api.get<{ success: boolean; data: AgentSkill[] }>(`/admin/skills/agents/${userId}`);
      return res.data.data;
    },

    assignSkill: async (
      userId: string,
      payload: { bot_option_id: string; level: 'junior' | 'intermediate' | 'senior' },
    ) => {
      const res = await api.post<{ success: boolean; data: { user_id: string; bot_option_id: string; level: string } }>(
        `/admin/skills/agents/${userId}`,
        payload,
      );
      return res.data.data;
    },

    removeSkill: async (userId: string, botOptionId: string): Promise<{ removed: boolean }> => {
      const res = await api.delete<{ success: boolean; data: { removed: boolean } }>(
        `/admin/skills/agents/${userId}/${botOptionId}`,
      );
      return res.data.data;
    },
  },

  quickReplies: {
    list: async (params?: QuickRepliesListParams): Promise<QuickReply[]> => {
      const res = await api.get<{ success: boolean; data: QuickReply[] }>('/admin/quick-replies', { params });
      return res.data.data;
    },

    create: async (data: CreateQuickReplyPayload): Promise<QuickReply> => {
      const res = await api.post<{ success: boolean; data: QuickReply }>('/admin/quick-replies', data);
      return res.data.data;
    },

    update: async (id: string, data: Partial<CreateQuickReplyPayload>): Promise<QuickReply> => {
      const res = await api.patch<{ success: boolean; data: QuickReply }>(`/admin/quick-replies/${id}`, data);
      return res.data.data;
    },

    delete: async (id: string): Promise<QuickReply> => {
      const res = await api.delete<{ success: boolean; data: QuickReply }>(`/admin/quick-replies/${id}`);
      return res.data.data;
    },
  },

  ai: {
    getConfig: async (): Promise<AIAgentConfig> => {
      const res = await api.get<{ success: boolean; data: AIAgentConfig }>('/admin/ai/config');
      return res.data.data;
    },

    updateConfig: async (data: Partial<AIAgentConfig>): Promise<void> => {
      await api.patch('/admin/ai/config', data);
    },

    listArticles: async (): Promise<KnowledgeArticle[]> => {
      const res = await api.get<{ success: boolean; data: KnowledgeArticle[] }>('/admin/ai/knowledge');
      return res.data.data;
    },

    createManualArticle: async (data: { title: string; content: string }): Promise<{ id: string }> => {
      const res = await api.post<{ success: boolean; data: { id: string } }>('/admin/ai/knowledge/manual', data);
      return res.data.data;
    },

    createUrlArticle: async (data: { url: string; title?: string }): Promise<{ id: string }> => {
      const res = await api.post<{ success: boolean; data: { id: string } }>('/admin/ai/knowledge/url', data);
      return res.data.data;
    },

    createFileArticle: async (file: File, title?: string): Promise<{ id: string }> => {
      const form = new FormData();
      form.append('file', file);
      if (title) form.append('title', title);
      const res = await api.post<{ success: boolean; data: { id: string } }>('/admin/ai/knowledge/file', form);
      return res.data.data;
    },

    deleteArticle: async (id: string): Promise<void> => {
      await api.delete(`/admin/ai/knowledge/${id}`);
    },

    toggleArticle: async (id: string, isActive: boolean): Promise<void> => {
      await api.patch(`/admin/ai/knowledge/${id}/toggle`, { is_active: isActive });
    },
  },

  webhooks: {
    list: async (): Promise<OutboundWebhook[]> => {
      const res = await api.get<{ success: boolean; data: OutboundWebhook[] }>('/admin/webhooks');
      return res.data.data;
    },

    create: async (data: CreateWebhookPayload): Promise<OutboundWebhook> => {
      const res = await api.post<{ success: boolean; data: OutboundWebhook }>('/admin/webhooks', data);
      return res.data.data;
    },

    get: async (id: string): Promise<OutboundWebhook> => {
      const res = await api.get<{ success: boolean; data: OutboundWebhook }>(`/admin/webhooks/${id}`);
      return res.data.data;
    },

    update: async (id: string, data: Partial<CreateWebhookPayload>): Promise<OutboundWebhook> => {
      const res = await api.patch<{ success: boolean; data: OutboundWebhook }>(`/admin/webhooks/${id}`, data);
      return res.data.data;
    },

    delete: async (id: string): Promise<OutboundWebhook> => {
      const res = await api.delete<{ success: boolean; data: OutboundWebhook }>(`/admin/webhooks/${id}`);
      return res.data.data;
    },

    test: async (id: string): Promise<{ success: boolean; data: { status: number } }> => {
      const res = await api.post<{ success: boolean; data: { status: number } }>(`/admin/webhooks/${id}/test`);
      return res.data;
    },
  },

  templates: {
    list: async (params?: { channel_id?: string }): Promise<WhatsAppTemplate[]> => {
      const res = await api.get<{ success: boolean; data: WhatsAppTemplate[] }>('/admin/templates', { params });
      return res.data.data;
    },

    get: async (id: string): Promise<WhatsAppTemplate> => {
      const res = await api.get<{ success: boolean; data: WhatsAppTemplate }>(`/admin/templates/${id}`);
      return res.data.data;
    },

    create: async (data: CreateWhatsAppTemplatePayload): Promise<WhatsAppTemplate> => {
      const res = await api.post<{ success: boolean; data: WhatsAppTemplate }>('/admin/templates', data);
      return res.data.data;
    },

    update: async (id: string, data: UpdateWhatsAppTemplatePayload): Promise<WhatsAppTemplate> => {
      const res = await api.patch<{ success: boolean; data: WhatsAppTemplate }>(`/admin/templates/${id}`, data);
      return res.data.data;
    },

    uploadMedia: async (channelId: string, file: File): Promise<WhatsAppTemplateMediaUpload> => {
      const form = new FormData();
      form.append('channelId', channelId);
      form.append('file', file);
      const res = await api.post<{ success: boolean; data: WhatsAppTemplateMediaUpload }>(
        '/admin/templates/media-upload',
        form,
      );
      return res.data.data;
    },

    remove: async (id: string): Promise<WhatsAppTemplate> => {
      const res = await api.delete<{ success: boolean; data: WhatsAppTemplate }>(`/admin/templates/${id}`);
      return res.data.data;
    },

    sync: async (channelId: string): Promise<{ count: number; templates: WhatsAppTemplate[] }> => {
      const res = await api.post<{ success: boolean; data: { count: number; templates: WhatsAppTemplate[] } }>(
        '/admin/templates/sync',
        { channelId },
      );
      return res.data.data;
    },
  },

  integrations: {
    redmine: {
      get: async (): Promise<RedmineIntegrationConfig | null> => {
        const res = await api.get<{ success: boolean; data: RedmineIntegrationConfig | null }>(
          '/admin/integrations/redmine',
        );
        return res.data.data;
      },

      save: async (data: SaveRedmineIntegrationPayload): Promise<RedmineIntegrationConfig> => {
        const res = await api.post<{ success: boolean; data: RedmineIntegrationConfig }>(
          '/admin/integrations/redmine',
          data,
        );
        return res.data.data;
      },

      update: async (data: UpdateRedmineIntegrationPayload): Promise<RedmineIntegrationConfig> => {
        const res = await api.patch<{ success: boolean; data: RedmineIntegrationConfig }>(
          '/admin/integrations/redmine',
          data,
        );
        return res.data.data;
      },

      remove: async (): Promise<{ removed: boolean }> => {
        const res = await api.delete<{ success: boolean; data: { removed: boolean } }>(
          '/admin/integrations/redmine',
        );
        return res.data.data;
      },

      test: async (data?: { redmineUrl?: string; apiKey?: string }): Promise<{ ok: true }> => {
        const res = await api.post<{ success: boolean; data: { ok: true } }>(
          '/admin/integrations/redmine/test',
          data ?? {},
        );
        return res.data.data;
      },
    },
  },
};

interface TenantLgpdMetrics {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  counts: { total: number; pending: number; processed: number; rejected: number; breached: number; near_sla: number };
  avg_response_hours: number | null;
  breached_requests: Array<{
    id: string;
    subject_type: string;
    request_type: string;
    requested_at: string;
    sla_deadline: string | null;
    days_overdue: number;
  }>;
}

export const superAdminApi = {
  getLgpdMetrics: async (): Promise<{
    tenants: TenantLgpdMetrics[];
    summary: {
      total_tenants: number;
      tenants_with_pending: number;
      tenants_with_breaches: number;
      global_pending: number;
      global_breached: number;
      global_near_sla: number;
    };
  }> => {
    const res = await api.get<{ success: boolean; data: {
      tenants: TenantLgpdMetrics[];
      summary: {
        total_tenants: number;
        tenants_with_pending: number;
        tenants_with_breaches: number;
        global_pending: number;
        global_breached: number;
        global_near_sla: number;
      };
    } }>('/super-admin/metrics/lgpd');
    return res.data.data;
  },
};

export const conversationTags = {
  list: async (): Promise<ConversationTag[]> => {
    const res = await api.get<{ success: boolean; data: ConversationTag[] }>('/admin/conversation-tags');
    return res.data.data;
  },

  listAvailable: async (): Promise<ConversationTag[]> => {
    const res = await api.get<{ success: boolean; data: ConversationTag[] }>('/omnichannel/conversations/tags');
    return res.data.data;
  },

  create: async (data: { name: string; color: string; sort_order?: number }): Promise<ConversationTag> => {
    const res = await api.post<{ success: boolean; data: ConversationTag }>('/admin/conversation-tags', data);
    return res.data.data;
  },

  update: async (
    id: string,
    data: Partial<{ name: string; color: string; sort_order: number; is_active: boolean }>,
  ): Promise<ConversationTag> => {
    const res = await api.patch<{ success: boolean; data: ConversationTag }>(`/admin/conversation-tags/${id}`, data);
    return res.data.data;
  },

  delete: async (id: string): Promise<ConversationTag> => {
    const res = await api.delete<{ success: boolean; data: ConversationTag }>(`/admin/conversation-tags/${id}`);
    return res.data.data;
  },

  getForConversation: async (convId: string): Promise<ConversationTagAssignment[]> => {
    const res = await api.get<{ success: boolean; data: ConversationTagAssignment[] }>(
      `/omnichannel/conversations/${convId}/tags`,
    );
    return res.data.data;
  },

  addToConversation: async (convId: string, tagId: string) => {
    const res = await api.post<{ success: boolean; data: { conversationId: string; tagId: string } }>(
      `/omnichannel/conversations/${convId}/tags`,
      { tag_id: tagId },
    );
    return res.data.data;
  },

  removeFromConversation: async (convId: string, tagId: string) => {
    const res = await api.delete<{ success: boolean; data: { removed: boolean } }>(
      `/omnichannel/conversations/${convId}/tags/${tagId}`,
    );
    return res.data.data;
  },
};

export const contactTags = {
  list: async (): Promise<ContactTag[]> => {
    const res = await api.get<{ success: boolean; data: ContactTag[] }>('/admin/contact-tags');
    return res.data.data;
  },

  create: async (data: { name: string; color: string; sort_order?: number }): Promise<ContactTag> => {
    const res = await api.post<{ success: boolean; data: ContactTag }>('/admin/contact-tags', data);
    return res.data.data;
  },

  update: async (
    id: string,
    data: Partial<{ name: string; color: string; sort_order: number }>,
  ): Promise<ContactTag> => {
    const res = await api.patch<{ success: boolean; data: ContactTag }>(`/admin/contact-tags/${id}`, data);
    return res.data.data;
  },

  delete: async (id: string): Promise<ContactTag> => {
    const res = await api.delete<{ success: boolean; data: ContactTag }>(`/admin/contact-tags/${id}`);
    return res.data.data;
  },
};

export interface CallRecord {
  id: string;
  conversation_id: string;
  agent_id: string | null;
  call_sid: string;
  to_phone: string | null;
  from_phone: string | null;
  status: string;
  duration: number | null;
  recording_url: string | null;
  created_at: string;
  agent_name?: string | null;
}

export const callsApi = {
  getToken: async (): Promise<{ token: string }> => {
    const res = await api.get<{ success: boolean; token: string }>('/calls/token');
    return { token: res.data.token };
  },

  makeCall: async (data: { to_phone: string; conversation_id: string }) => {
    const res = await api.post<{ success: boolean; call_sid: string }>('/calls/make', data);
    return res.data;
  },

  getHistory: async (conversationId: string): Promise<CallRecord[]> => {
    const res = await api.get<{ success: boolean; data: CallRecord[] }>(`/calls/conversation/${conversationId}`);
    return res.data.data;
  },
};

// ── Tickets Types ─────────────────────────────────────────────────────────────

export type TicketStatus   = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Ticket {
  id:              string;
  contact_id?:     string | null;
  organization_id?: string | null;
  conversation_id: string | null;
  source_conversation_id?: string | null;
  type_id?: string | null;
  source?: string | null;
  email_message_id?: string | null;
  type_name?: string | null;
  type_icon?: string | null;
  type_color?: string | null;
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
  contact_name?:   string | null;
  organization_name?: string | null;
}

export interface TicketComment {
  id:            string;
  ticket_id:     string;
  user_id:       string | null;
  contact_id?:   string | null;
  source?:       string;
  content:       string;
  is_internal:   boolean;
  created_at:    string;
  author_name:   string | null;
  author_avatar: string | null;
  attachments?:  TicketAttachment[];
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  user_id: string | null;
  filename: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

export interface TicketTimelineEvent {
  id: string;
  ticket_id: string;
  user_id: string | null;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  user_name: string | null;
  avatar_url: string | null;
}

export interface TicketChecklistItem {
  id: string;
  ticket_id: string;
  title: string;
  is_done: boolean;
  done_by: string | null;
  done_at: string | null;
  sort_order: number;
  created_at: string;
  done_by_name: string | null;
}

export interface TicketTimeEntry {
  id: string;
  ticket_id: string;
  user_id: string;
  description: string | null;
  minutes: number;
  worked_at: string;
  created_at: string;
  user_name: string | null;
}

export interface TicketRelation {
  relation_id: string;
  relation_type: 'relates_to' | 'duplicates' | 'blocks' | 'is_blocked_by' | string;
  created_at: string;
  related_ticket_id: string;
  related_title: string;
  related_status: TicketStatus | string;
  related_priority: TicketPriority | string;
  direction: 'incoming' | 'outgoing';
}

export interface TicketSearchResult {
  id: string;
  title: string;
  status: TicketStatus | string;
  priority: TicketPriority | string;
}

export interface AddTicketRelationPayload {
  related_id: string;
  relation_type: 'relates_to' | 'duplicates' | 'blocks' | 'is_blocked_by';
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
  source?:      'manual' | 'portal' | 'email' | 'whatsapp' | 'api';
  contact_id?:  string;
  organization_id?: string;
  category?:    string;
  date_from?:   string;
  date_to?:     string;
  sort_by?:     'created_at' | 'updated_at' | 'priority' | 'due_date';
  sort_order?:  'asc' | 'desc';
}

export interface ExportTicketsParams {
  search?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigned_to?: string;
  source?: 'manual' | 'portal' | 'email' | 'whatsapp' | 'api';
  contact_id?: string;
  organization_id?: string;
  category?: string;
  date_from?: string;
  date_to?: string;
}

export interface CreateTicketPayload {
  title:           string;
  description?:    string;
  status?:         TicketStatus;
  priority?:       TicketPriority;
  category?:       string;
  type_id?:        string | null;
  assigned_to?:    string | null;
  contact_id?:     string;
  organization_id?: string;
  conversation_id?: string;
  source_conversation_id?: string;
  due_date?:       string;
  tags?:           string[];
}

export interface CreateCommentPayload {
  content:     string;
  is_internal: boolean;
}

export interface UpdateCommentPayload {
  content: string;
}

export interface CreateTicketTimePayload {
  minutes: number;
  description?: string;
  worked_at?: string;
}

// ── Tickets API ───────────────────────────────────────────────────────────────

// ── Omnichannel Types ─────────────────────────────────────────────────────────

export interface TransferAgent {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  active_conversations: number;
  is_available: boolean;
}

export interface TransferSkill {
  id: string;
  name: string;
  online_agents_count: number;
}

export interface OmnichannelConversation {
  id: string;
  status: string;
  channel_type: string;
  conversation_type?: 'inbound' | 'outbound' | string | null;
  protocol_number?: string | null;
  subject: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  resolved_at: string | null;
  closed_at?: string | null;
  close_type_id?: string | null;
  close_outcome_id?: string | null;
  csat_score?: number | null;
  csat_comment?: string | null;
  csat_sent_at?: string | null;
  csat_responded_at?: string | null;
  csat_stage?: 'sent' | 'waiting_comment' | 'done' | null;
  contact_id?: string | null;
  organization_id?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
  organization_name?: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  assigned_name: string | null;
  queue_entered_at?: string | null;
  channel_id: string | null;
  channel_name: string | null;
  bot_option_id?: string | null;
  bot_department?: string | null;
  metadata?: Record<string, unknown> | null;
  unread_count?: number;
  tags?: ConversationTag[];
}

export interface OmnichannelMessage {
  id: string;
  conversation_id: string;
  sender_type: 'agent' | 'client' | 'bot' | 'system';
  sender_id: string | null;
  content: string;
  content_type: 'text' | 'image' | 'audio' | 'video' | 'document' | string;
  media_url?: string | null;
  external_id?: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  is_internal: boolean;
  created_at: string;
  metadata?: {
    filename?: string;
    source?: string;
    mention?: {
      message_id: string;
      sender_type: 'agent' | 'client' | 'bot' | 'system' | string;
      sender_label: string;
      content: string;
      content_type: 'text' | 'image' | 'audio' | 'video' | 'document' | string;
      external_id?: string | null;
      media_id?: string | null;
      media_subtype?: string | null;
    };
  } & Record<string, unknown>;
}

export interface ListConversationsParams {
  page?: number;
  perPage?: number;
  per_page?: number;
  tab?: 'open' | 'waiting' | 'closed';
  search?: string;
  status?: string;
  assigned_to_me?: boolean;
  agent_id?: string;
  contact_id?: string;
  organization_id?: string;
  tag_id?: string;
}

export interface CreateConversationPayload {
  contact_id: string;
  organization_id?: string;
  channel_id: string;
  type?: 'inbound' | 'outbound';
  subject?: string;
  initial_message?: string;
  initial_template?: {
    name: string;
    language?: string;
    components?: Array<Record<string, unknown>>;
  };
}

export interface ActiveOutboundTemplate extends WhatsAppTemplate {}

export interface CreateActiveOutboundPayload {
  contactId: string;
  channelId: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: Array<Record<string, unknown>>;
  subject?: string;
  message?: string;
  useTemplate?: boolean;
}

export interface WhatsAppWindowStatus {
  withinWindow: boolean;
  lastClientMessageAt: string | null;
}

export interface SendMessagePayload {
  content?: string;
  contentType?: 'text' | 'image' | 'audio' | 'video' | 'document' | 'template';
  isInternal?: boolean;
  media_id?: string;
  media_type?: 'image' | 'audio' | 'video' | 'document';
  media_filename?: string;
  mention_message_id?: string;
  whatsapp_template?: {
    name: string;
    language?: string;
    components?: Array<Record<string, unknown>>;
  };
}

export interface UploadedMediaResponse {
  media_id: string;
  media_type: 'image' | 'audio' | 'video' | 'document';
  filename: string;
  size: number;
}

export interface ListMessagesParams {
  page?: number;
  per_page?: number;
  before?: string;
}

export interface MetricsFiltersParams {
  date_from?: string;
  date_to?: string;
  agent_id?: string;
  channel_type?: string;
  department?: string;
}

export type HistoryPeriodPreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'last_week' | 'last_month' | 'custom';

export interface HistoryFiltersParams {
  page?: number;
  per_page?: number;
  search?: string;
  status?: string;
  assigned_to?: string;
  channel_type?: string;
  bot_option_id?: string;
  csat_rating?: '1' | '2' | '3' | '4' | '5' | 'none';
  period?: HistoryPeriodPreset;
  date_from?: string;
  date_to?: string;
}

export interface OmnichannelHistoryConversation {
  id: string;
  protocol_number: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_avatar: string | null;
  channel_type: string;
  bot_option_id: string | null;
  bot_department: string | null;
  status: string;
  duration_seconds: number;
  wait_seconds: number | null;
  csat_score: number | null;
  created_at: string;
}

export interface OmnichannelHistoryMeta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface OmnichannelHistoryTimelineItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  created_at: string;
}

export interface OmnichannelHistoryMessage {
  id: string;
  sender_type: string;
  sender_id: string | null;
  sender_name: string | null;
  content: string | null;
  content_type: string;
  media_url: string | null;
  is_internal: boolean;
  status: string;
  created_at: string;
}

export interface OmnichannelHistoryDetail {
  conversation: {
    id: string;
    protocol_number: string | null;
    status: string;
    channel_type: string;
    conversation_type: string;
    subject: string | null;
    close_type_id: string | null;
    close_outcome_id: string | null;
    close_type_label: string | null;
    close_outcome_label: string | null;
    created_at: string;
    assigned_at: string | null;
    resolved_at: string | null;
    closed_at: string | null;
    csat_score: number | null;
    csat_comment: string | null;
    csat_sent_at: string | null;
    csat_responded_at: string | null;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    contact_whatsapp: string | null;
    organization_name: string | null;
    assigned_name: string | null;
    assigned_avatar: string | null;
    channel_name: string | null;
    metadata: Record<string, unknown> | null;
  };
  timeline: OmnichannelHistoryTimelineItem[];
  transcript: OmnichannelHistoryMessage[];
}

export type GoalScope = 'global' | 'agent';
export type GoalPeriod = 'daily' | 'weekly' | 'monthly';

export interface GoalPayload {
  name: string;
  scope: GoalScope;
  agentId?: string | null;
  period: GoalPeriod;
  goalTmaMinutes?: number | null;
  goalTmeMinutes?: number | null;
  goalSlaPercent?: number | null;
  goalCsatMin?: number | null;
  goalVolumeMin?: number | null;
  isActive?: boolean;
}

export interface OmnichannelGoal {
  id: string;
  name: string;
  scope: GoalScope | 'group';
  agentId: string | null;
  agentName: string | null;
  botOptionId?: string | null;
  botOptionLabel?: string | null;
  period: GoalPeriod;
  goalTmaMinutes: number | null;
  goalTmeMinutes: number | null;
  goalSlaPercent: number | null;
  goalCsatMin: number | null;
  goalVolumeMin: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PerformanceMetricStatus = 'ok' | 'warning' | 'breach' | 'no_goal';

export interface PerformanceFiltersParams {
  period?: HistoryPeriodPreset;
  date_from?: string;
  date_to?: string;
  agent_id?: string;
  bot_option_id?: string;
  page?: number;
  per_page?: number;
}

export interface OmnichannelPerformanceGoal {
  id: string;
  name: string;
  scope: GoalScope;
  period: GoalPeriod;
  goal_tma_minutes: number | null;
  goal_tme_minutes: number | null;
  goal_sla_percent: number | null;
  goal_csat_min: number | null;
  goal_volume_min: number | null;
}

export interface OmnichannelPerformanceAgent {
  agent_id: string;
  agent_name: string;
  avatar_url: string | null;
  total_conversations: number;
  avg_tma_minutes: number | null;
  avg_tme_minutes: number | null;
  avg_csat: number | null;
  csat_count: number;
  sla_percent: number | null;
  sla_ok: number;
  sla_breach: number;
  goal: OmnichannelPerformanceGoal | null;
  goal_status: {
    tma: PerformanceMetricStatus | null;
    tme: PerformanceMetricStatus | null;
    sla: PerformanceMetricStatus | null;
    csat: PerformanceMetricStatus | null;
    volume: PerformanceMetricStatus | null;
    overall: PerformanceMetricStatus | null;
  } | null;
}

export interface OmnichannelPerformanceResponse {
  data: OmnichannelPerformanceAgent[];
  meta: OmnichannelHistoryMeta;
  team_kpis: {
    avg_tma_minutes: number | null;
    avg_tme_minutes: number | null;
    avg_csat: number | null;
    sla_percent: number | null;
    total_volume: number;
  };
}

export interface PerformanceByGroupRow {
  bot_option_id: string | null;
  group_name: string;
  total_conversations: number;
  avg_tma_minutes: number | null;
  avg_tme_minutes: number | null;
  avg_csat: number | null;
  sla_percent: number | null;
}

export interface PerformanceByGroupResponse {
  data: PerformanceByGroupRow[];
}

export interface MetricsOverviewData {
  total: {
    total: number;
    resolved: number;
    open: number;
    bot: number;
  };
  tma: number;
  first_response_minutes: number;
  csat: {
    avg_score: number | null;
    total_responses: number;
    positive: number;
  };
  byType: MetricsByTypePoint[];
  byOutcome: MetricsByOutcomePoint[];
}

export interface MetricsVolumePoint {
  date: string;
  total: number;
  resolved: number;
}

export interface MetricsByAgentPoint {
  agent_name: string;
  agent_id: string;
  total: number;
  resolved: number;
  avg_minutes: number | null;
  avg_csat: number | null;
}

export interface MetricsByChannelPoint {
  channel_type: string;
  total: number;
}

export interface MetricsByDepartmentPoint {
  department: string;
  total: number;
  avg_csat: number | null;
}

export interface MetricsPeakHoursPoint {
  day_of_week: number;
  hour: number;
  total: number;
}

export interface MetricsCsatPoint {
  score: number;
  total: number;
}

export interface MetricsByTypePoint {
  typeId: string;
  label: string;
  count: number;
  percentage: number;
}

export interface MetricsByOutcomePoint {
  outcomeId: string;
  label: string;
  count: number;
  percentage: number;
}

export interface OmnichannelMessagesPage {
  data: OmnichannelMessage[];
  has_more: boolean;
  total: number;
}

export interface ConversationWindowStatus {
  withinWindow: boolean;
  lastMessageAt: string | null;
}

export interface NotificationItem {
  id: string;
  type: 'ticket_assigned' | 'conversation_assigned' | 'ticket_comment' | 'conversation_message' | 'message_failed' | 'help_requested';
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  href: string;
  data?: Record<string, unknown>;
}

export interface NotificationsMeta {
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface NotificationsListResponse {
  data: NotificationItem[];
  meta: NotificationsMeta;
}

export interface GlobalSearchResult {
  contacts: Array<{ id: string; name: string; email: string | null; phone: string | null }>;
  tickets: Array<{ id: string; title: string; status: string }>;
  conversations: Array<{ id: string; last_message: string | null; contact_name: string | null }>;
}

export interface OnboardingStatus {
  has_users: boolean;
  has_channels: boolean;
  has_organizations: boolean;
  has_conversations: boolean;
  tenant_created_at?: string;
  completion?: number;
  is_new_tenant?: boolean;
}

// ── Omnichannel API ───────────────────────────────────────────────────────────

export const omnichannelApi = {
  monitor: async (): Promise<MonitorData> => {
    const res = await api.get<{ success: boolean; data: MonitorData }>('/omnichannel/monitor');
    return res.data.data;
  },
  tv: async (): Promise<TvDashboardData> => {
    const res = await api.get<{ success: boolean; data: TvDashboardData }>('/omnichannel/tv');
    return res.data.data;
  },
  monitorBot: async (): Promise<MonitorBotData> => {
    const res = await api.get<{ success: boolean; data: MonitorBotData }>('/omnichannel/monitor/bot');
    return res.data.data;
  },
  pullMonitorBotConversation: async (conversationId: string): Promise<void> => {
    await api.post(`/omnichannel/monitor/bot/${conversationId}/pull`);
  },
  closeMonitorBotConversation: async (conversationId: string, message?: string): Promise<void> => {
    await api.post(`/omnichannel/monitor/bot/${conversationId}/close`, {
      message: message?.trim() || undefined,
    });
  },

  metrics: {
    getOverview: async (params?: MetricsFiltersParams): Promise<MetricsOverviewData> => {
      const res = await api.get<{ success: boolean; data: MetricsOverviewData }>('/omnichannel/metrics/overview', { params });
      return res.data.data;
    },
    getVolume: async (params?: MetricsFiltersParams): Promise<MetricsVolumePoint[]> => {
      const res = await api.get<{ success: boolean; data: MetricsVolumePoint[] }>('/omnichannel/metrics/volume', { params });
      return res.data.data;
    },
    getByAgent: async (params?: MetricsFiltersParams): Promise<MetricsByAgentPoint[]> => {
      const res = await api.get<{ success: boolean; data: MetricsByAgentPoint[] }>('/omnichannel/metrics/by-agent', { params });
      return res.data.data;
    },
    getByChannel: async (params?: MetricsFiltersParams): Promise<MetricsByChannelPoint[]> => {
      const res = await api.get<{ success: boolean; data: MetricsByChannelPoint[] }>('/omnichannel/metrics/by-channel', { params });
      return res.data.data;
    },
    getByDepartment: async (params?: MetricsFiltersParams): Promise<MetricsByDepartmentPoint[]> => {
      const res = await api.get<{ success: boolean; data: MetricsByDepartmentPoint[] }>('/omnichannel/metrics/by-department', { params });
      return res.data.data;
    },
    getPeakHours: async (params?: MetricsFiltersParams): Promise<MetricsPeakHoursPoint[]> => {
      const res = await api.get<{ success: boolean; data: MetricsPeakHoursPoint[] }>('/omnichannel/metrics/peak-hours', { params });
      return res.data.data;
    },
    getCsat: async (params?: MetricsFiltersParams): Promise<MetricsCsatPoint[]> => {
      const res = await api.get<{ success: boolean; data: MetricsCsatPoint[] }>('/omnichannel/metrics/csat', { params });
      return res.data.data;
    },
  },

  listHistory: async (
    params?: HistoryFiltersParams,
  ): Promise<{ data: OmnichannelHistoryConversation[]; meta: OmnichannelHistoryMeta }> => {
    const res = await api.get<{
      success: boolean;
      data: OmnichannelHistoryConversation[];
      meta: OmnichannelHistoryMeta;
    }>('/omnichannel/history', { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  getHistoryDetail: async (conversationId: string): Promise<OmnichannelHistoryDetail> => {
    const res = await api.get<{ success: boolean; data: OmnichannelHistoryDetail }>(
      `/omnichannel/history/${conversationId}`,
    );
    return res.data.data;
  },

  exportHistoryCsv: async (params?: HistoryFiltersParams): Promise<Blob> => {
    const res = await api.get<Blob>('/omnichannel/history', {
      params: { ...params, export: 'csv' },
      responseType: 'blob',
    });
    return res.data;
  },

  listGoals: async (): Promise<OmnichannelGoal[]> => {
    const res = await api.get<{ success: boolean; data: OmnichannelGoal[] }>('/omnichannel/goals');
    return res.data.data;
  },

  createGoal: async (payload: GoalPayload): Promise<OmnichannelGoal> => {
    const res = await api.post<{ success: boolean; data: OmnichannelGoal }>('/omnichannel/goals', payload);
    return res.data.data;
  },

  updateGoal: async (goalId: string, payload: GoalPayload): Promise<OmnichannelGoal> => {
    const res = await api.patch<{ success: boolean; data: OmnichannelGoal }>(`/omnichannel/goals/${goalId}`, payload);
    return res.data.data;
  },

  deleteGoal: async (goalId: string): Promise<{ id: string }> => {
    const res = await api.delete<{ success: boolean; data: { id: string } }>(`/omnichannel/goals/${goalId}`);
    return res.data.data;
  },

  listPerformance: async (params?: PerformanceFiltersParams): Promise<OmnichannelPerformanceResponse> => {
    const res = await api.get<{ success: boolean } & OmnichannelPerformanceResponse>('/omnichannel/performance', { params });
    return {
      data: res.data.data,
      meta: res.data.meta,
      team_kpis: res.data.team_kpis,
    };
  },

  listPerformanceByGroup: async (params?: PerformanceFiltersParams): Promise<PerformanceByGroupResponse> => {
    const res = await api.get<{ success: boolean } & PerformanceByGroupResponse>('/omnichannel/performance/by-group', { params });
    return { data: res.data.data };
  },

  exportPerformanceCsv: async (params?: PerformanceFiltersParams): Promise<Blob> => {
    const res = await api.get<Blob>('/omnichannel/performance', {
      params: { ...params, export: 'csv' },
      responseType: 'blob',
    });
    return res.data;
  },

  listConversations: async (params?: ListConversationsParams): Promise<OmnichannelConversation[]> => {
    const res = await api.get<{ success: boolean; data: OmnichannelConversation[] }>(
      '/omnichannel/conversations',
      { params },
    );
    return res.data.data;
  },

  listConversationChannels: async (): Promise<Array<Pick<Channel, 'id' | 'type' | 'name' | 'status'>>> => {
    const res = await api.get<{ success: boolean; data: Array<Pick<Channel, 'id' | 'type' | 'name' | 'status'>> }>(
      '/omnichannel/conversations/channels',
    );
    return res.data.data;
  },

  getCloseConfig: async (): Promise<ConversationCloseConfigPreview> => {
    const res = await api.get<{ success: boolean; data: ConversationCloseConfigPreview }>(
      '/omnichannel/close-config',
    );
    return res.data.data;
  },

  getConversation: async (id: string): Promise<{ conversation: OmnichannelConversation; messages: OmnichannelMessage[] }> => {
    const res = await api.get<{ success: boolean; data: { conversation: OmnichannelConversation; messages: OmnichannelMessage[] } }>(
      `/omnichannel/conversations/${id}`,
    );
    return res.data.data;
  },

  getConversationWindowStatus: async (conversationId: string): Promise<ConversationWindowStatus> => {
    const res = await api.get<{ success: boolean; data: ConversationWindowStatus }>(
      `/omnichannel/conversations/${conversationId}/window-status`,
    );
    return res.data.data;
  },

  createConversation: async (payload: CreateConversationPayload): Promise<{ conversation: OmnichannelConversation }> => {
    const res = await api.post<{ success: boolean; data: OmnichannelConversation }>(
      '/omnichannel/conversations',
      payload,
    );
    return { conversation: res.data.data };
  },

  listActiveOutboundTemplates: async (channelId?: string): Promise<ActiveOutboundTemplate[]> => {
    const params = channelId ? { channel_id: channelId } : undefined;
    const res = await api.get<{ success: boolean; data: ActiveOutboundTemplate[] }>('/omnichannel/templates', { params });
    return res.data.data;
  },

  listTemplates: async (channelId: string): Promise<{ data: ActiveOutboundTemplate[] }> => {
    const res = await api.get<{ success: boolean; data: ActiveOutboundTemplate[] }>('/omnichannel/templates', {
      params: { channel_id: channelId },
    });
    return { data: res.data.data };
  },

  createActiveOutbound: async (payload: CreateActiveOutboundPayload): Promise<OmnichannelConversation> => {
    const res = await api.post<{ success: boolean; data: OmnichannelConversation }>(
      '/omnichannel/active-outbound',
      payload,
    );
    return res.data.data;
  },

  getWindowStatus: async (contactId: string, channelId: string): Promise<WhatsAppWindowStatus> => {
    const res = await api.get<{ success: boolean; data: WhatsAppWindowStatus }>(
      '/omnichannel/active-outbound/window-status',
      { params: { contactId, channelId } },
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

  uploadMedia: async (conversationId: string, file: File): Promise<UploadedMediaResponse> => {
    const form = new FormData();
    form.append('conversation_id', conversationId);
    form.append('file', file);

    const res = await api.post<{ success: boolean; data: UploadedMediaResponse }>(
      '/omnichannel/media/upload',
      form,
    );
    return res.data.data;
  },

  getMediaInfo: async (mediaId: string, conversationId: string) => {
    const res = await api.get<{ success: boolean; data: { url: string; mime_type?: string; file_size?: number } }>(
      `/omnichannel/media/${mediaId}/info`,
      { params: { conversation_id: conversationId } },
    );
    return res.data.data;
  },

  downloadMedia: async (mediaId: string, conversationId: string): Promise<Blob> => {
    const res = await api.get<Blob>(`/omnichannel/media/${mediaId}/content`, {
      params: { conversation_id: conversationId },
      responseType: 'blob',
    });
    return res.data;
  },

  downloadMediaById: async (mediaId: string): Promise<Blob> => {
    const res = await api.get<Blob>(`/omnichannel/media/${mediaId}`, {
      responseType: 'blob',
    });
    return res.data;
  },

  updateConversation: async (
    conversationId: string,
    payload: {
      status?: 'open' | 'waiting' | 'closed';
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

  closeConversation: async (
    conversationId: string,
    data: { reason: string; notes?: string; closeTypeId?: string; closeOutcomeId?: string },
  ): Promise<OmnichannelConversation> => {
    const res = await api.post<{ success: boolean; data: OmnichannelConversation }>(
      `/omnichannel/conversations/${conversationId}/close`,
      data,
    );
    return res.data.data;
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

  transfer: async (
    conversationId: string,
    target: { userId: string; skillId?: undefined } | { userId?: undefined; skillId: string },
    reason?: string,
  ): Promise<OmnichannelConversation> => {
    const body = target.userId
      ? { user_id: target.userId, reason }
      : { skill_id: target.skillId, reason };
    const res = await api.post<{ success: boolean; data: OmnichannelConversation }>(
      `/omnichannel/conversations/${conversationId}/transfer`,
      body,
    );
    return res.data.data;
  },

  getTransferAgents: async (currentAgentId?: string): Promise<TransferAgent[]> => {
    const params = currentAgentId ? { current_agent_id: currentAgentId } : {};
    const res = await api.get<{ success: boolean; data: TransferAgent[] }>('/omnichannel/transfer/agents', { params });
    return res.data.data;
  },

  getTransferSkills: async (): Promise<TransferSkill[]> => {
    const res = await api.get<{ success: boolean; data: TransferSkill[] }>('/omnichannel/transfer/skills');
    return res.data.data;
  },

  updateConversationGroup: async (
    conversationId: string,
    bot_option_id: string | null,
  ): Promise<{ id: string; bot_option_id: string | null; bot_department: string | null }> => {
    const res = await api.patch<{
      success: boolean;
      data: { id: string; bot_option_id: string | null; bot_department: string | null };
    }>(`/omnichannel/conversations/${conversationId}/group`, { bot_option_id });
    return res.data.data;
  },

  setAvailability: async (data: { is_available: boolean }): Promise<AutoAssignAgent> => {
    const res = await api.put<{ success: boolean; data: AutoAssignAgent }>('/omnichannel/availability', data);
    return res.data.data;
  },

  requestHelp: async (conversationId: string, helperUserId: string) => {
    const res = await api.post<{ success: boolean; data: ConversationHelper }>(
      `/omnichannel/conversations/${conversationId}/request-help`,
      { helper_user_id: helperUserId },
    );
    return res.data.data;
  },

  acceptHelp: async (conversationId: string) => {
    const res = await api.post<{ success: boolean; data: ConversationHelper }>(
      `/omnichannel/conversations/${conversationId}/accept-help`,
    );
    return res.data.data;
  },

  declineHelp: async (conversationId: string) => {
    const res = await api.post<{ success: boolean; data: ConversationHelper }>(
      `/omnichannel/conversations/${conversationId}/decline-help`,
    );
    return res.data.data;
  },

  endHelp: async (conversationId: string): Promise<{ updated: number }> => {
    const res = await api.delete<{ success: boolean; data: { updated: number } }>(
      `/omnichannel/conversations/${conversationId}/help`,
    );
    return res.data.data;
  },

  getHelpers: async (conversationId: string): Promise<ConversationHelper[]> => {
    const res = await api.get<{ success: boolean; data: ConversationHelper[] }>(
      `/omnichannel/conversations/${conversationId}/helpers`,
    );
    return res.data.data;
  },

  getQueue: (params?: { channel_type?: string; page?: number }) =>
    api.get('/omnichannel/queue', { params }).then((r) => r.data),

  getQueueCount: () =>
    api.get('/omnichannel/queue', { params: { limit: 1 } }).then((r) => r.data.meta as { total: number }),

  assignMe: async (id: string): Promise<OmnichannelConversation> => {
    const res = await api.post<{ success: boolean; data: OmnichannelConversation }>(
      `/omnichannel/queue/${id}/assign-me`,
    );
    return res.data.data;
  },
};

// ── Campaign types ────────────────────────────────────────────────────────────

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
export type CampaignContactStatus = 'pending' | 'queued' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'opted_out';

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  channel_id: string | null;
  template_id: string | null;
  template_variables: Record<string, string>;
  template_header_media_url: string | null;
  template_header_media_filename: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  total_contacts: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  daily_limit: number;
  created_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  template_name?: string | null;
  channel_name?: string | null;
}

export interface CampaignContact {
  id: string;
  campaign_id: string;
  contact_id: string;
  status: CampaignContactStatus;
  message_id: string | null;
  conversation_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  failed_at: string | null;
  created_at: string;
  contact_name?: string | null;
  contact_phone?: string | null;
}

export interface CampaignReport {
  campaign: Campaign;
  breakdown: Array<{
    date: string;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    failed: number;
  }>;
}

export const campaignsApi = {
  list: async (params?: { page?: number; limit?: number; status?: string }): Promise<{
    data: Campaign[];
    meta: { total: number; page: number; limit: number; total_pages: number };
  }> => {
    const res = await api.get<{
      success: boolean;
      data: Campaign[];
      meta: { total: number; page: number; limit: number; total_pages: number };
    }>('/omnichannel/campaigns', { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  get: async (id: string): Promise<Campaign> => {
    const res = await api.get<{ success: boolean; data: Campaign }>(`/omnichannel/campaigns/${id}`);
    return res.data.data;
  },

  create: async (data: {
    name: string;
    channel_id: string;
    template_id: string;
    template_variables?: Record<string, string>;
    template_header_media_url?: string | null;
    template_header_media_filename?: string | null;
    scheduled_at?: string | null;
    daily_limit?: number;
    notes?: string | null;
  }): Promise<Campaign> => {
    const res = await api.post<{ success: boolean; data: Campaign }>('/omnichannel/campaigns', data);
    return res.data.data;
  },

  update: async (id: string, data: {
    name?: string;
    template_id?: string;
    template_variables?: Record<string, string>;
    template_header_media_url?: string | null;
    template_header_media_filename?: string | null;
    scheduled_at?: string | null;
    daily_limit?: number;
    notes?: string | null;
  }): Promise<Campaign> => {
    const res = await api.patch<{ success: boolean; data: Campaign }>(`/omnichannel/campaigns/${id}`, data);
    return res.data.data;
  },

  addContacts: async (id: string, contact_ids: string[]): Promise<{ added: number; total_contacts: number }> => {
    const res = await api.post<{ success: boolean; data: { added: number; total_contacts: number } }>(
      `/omnichannel/campaigns/${id}/contacts`,
      { contact_ids },
    );
    return res.data.data;
  },

  removeContact: async (id: string, contactId: string): Promise<void> => {
    await api.delete(`/omnichannel/campaigns/${id}/contacts/${contactId}`);
  },

  listContacts: async (id: string, params?: { page?: number; limit?: number }): Promise<{
    data: CampaignContact[];
    meta: { total: number; page: number; limit: number };
  }> => {
    const res = await api.get<{
      success: boolean;
      data: CampaignContact[];
      meta: { total: number; page: number; limit: number };
    }>(`/omnichannel/campaigns/${id}/contacts`, { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  launch: async (id: string): Promise<Campaign> => {
    const res = await api.post<{ success: boolean; data: Campaign }>(`/omnichannel/campaigns/${id}/launch`);
    return res.data.data;
  },

  pause: async (id: string): Promise<Campaign> => {
    const res = await api.post<{ success: boolean; data: Campaign }>(`/omnichannel/campaigns/${id}/pause`);
    return res.data.data;
  },

  resume: async (id: string): Promise<Campaign> => {
    const res = await api.post<{ success: boolean; data: Campaign }>(`/omnichannel/campaigns/${id}/resume`);
    return res.data.data;
  },

  cancel: async (id: string): Promise<Campaign> => {
    const res = await api.post<{ success: boolean; data: Campaign }>(`/omnichannel/campaigns/${id}/cancel`);
    return res.data.data;
  },

  duplicate: async (id: string): Promise<Campaign> => {
    const res = await api.post<{ success: boolean; data: Campaign }>(`/omnichannel/campaigns/${id}/duplicate`);
    return res.data.data;
  },

  duplicateFailed: async (id: string, data: {
    name: string;
    template_id: string;
    template_variables?: Record<string, string>;
    template_header_media_url?: string | null;
    template_header_media_filename?: string | null;
    scheduled_at?: string | null;
    daily_limit?: number;
    notes?: string | null;
  }): Promise<Campaign> => {
    const res = await api.post<{ success: boolean; data: Campaign }>(
      `/omnichannel/campaigns/${id}/duplicate-failed`,
      data,
    );
    return res.data.data;
  },

  report: async (id: string): Promise<CampaignReport> => {
    const res = await api.get<{ success: boolean; data: CampaignReport }>(`/omnichannel/campaigns/${id}/report`);
    return res.data.data;
  },

  stats: async (): Promise<{ total: number; running: number; completed: number; avg_delivery_rate: number }> => {
    const res = await api.get<{ success: boolean; data: { total: number; running: number; completed: number; avg_delivery_rate: number } }>('/omnichannel/campaigns/stats');
    return res.data.data;
  },
};

// ── Agent status API ──────────────────────────────────────────────────────────

export const agentStatusApi = {
  getStatus: async (): Promise<AgentPauseStatus> => {
    const res = await api.get<{ success: boolean; data: AgentPauseStatus }>('/omnichannel/pause/status');
    return res.data.data;
  },

  startPause: async (data: { reason: string; notes?: string }): Promise<AgentPauseStatus> => {
    const res = await api.post<{ success: boolean; data: AgentPauseStatus }>('/omnichannel/pause', data);
    return res.data.data;
  },

  endPause: async (): Promise<AgentPauseStatus> => {
    const res = await api.delete<{ success: boolean; data: AgentPauseStatus }>('/omnichannel/pause');
    return res.data.data;
  },
};

export const notificationsApi = {
  list: async (params?: { page?: number; per_page?: number }): Promise<NotificationsListResponse> => {
    const res = await api.get<{
      success: boolean;
      data: NotificationItem[];
      meta: NotificationsMeta;
    }>('/notifications', { params });
    return {
      data: res.data.data,
      meta: res.data.meta,
    };
  },

  markRead: async (id: string) => {
    const res = await api.patch<{ success: boolean; data: { read: boolean } }>(`/notifications/${id}/read`);
    return res.data.data;
  },

  markAllRead: async () => {
    const res = await api.patch<{ success: boolean; data: { read: number } }>('/notifications/read-all');
    return res.data.data;
  },

  deleteOne: async (id: string) => {
    const res = await api.delete<{ success: boolean; data: { deleted: boolean } }>(`/notifications/${id}`);
    return res.data.data;
  },

  deleteAllRead: async () => {
    const res = await api.delete<{ success: boolean; data: { deleted: number } }>('/notifications');
    return res.data.data;
  },
};

export const profileApi = {
  get: async (): Promise<MyProfile> => {
    const res = await api.get<{ success: boolean; data: MyProfile }>('/auth/me');
    return res.data.data;
  },

  update: async (payload: Partial<{
    name: string;
    bio: string | null;
    phone: string | null;
    language: 'pt-BR' | 'en-US' | 'es';
    notification_sound: boolean;
    notification_desktop: boolean;
  }>): Promise<MyProfile> => {
    const res = await api.patch<{ success: boolean; data: MyProfile }>('/auth/me', payload);
    return res.data.data;
  },

  updatePassword: async (payload: {
    current_password?: string | undefined;
    new_password?: string | undefined;
    currentPassword?: string | undefined;
    newPassword?: string | undefined;
  }): Promise<void> => {
    await api.patch('/auth/me/password', payload);
  },

  uploadAvatar: async (file: File): Promise<{ avatar_url: string }> => {
    const form = new FormData();
    form.append('file', file);

    const res = await api.post<{ success: boolean; data: { avatar_url: string } }>('/auth/me/avatar', form);
    return res.data.data;
  },

  getLgpdState: async (): Promise<ProfileLgpdState> => {
    const res = await api.get<{ success: boolean; data: ProfileLgpdState }>('/auth/me/lgpd');
    return res.data.data;
  },

  updateLgpdConsent: async (payload: { status: string; source?: string }): Promise<{ user: TenantUser; request: UserLgpdRequest }> => {
    const res = await api.patch<{ success: boolean; data: { user: TenantUser; request: UserLgpdRequest } }>(
      '/auth/me/lgpd/consent',
      payload,
    );
    return res.data.data;
  },

  exportLgpdData: async (params?: { include_audit_logs?: boolean }): Promise<UserLgpdExportPayload> => {
    const res = await api.get<{ success: boolean; data: UserLgpdExportPayload }>(
      '/auth/me/lgpd/export',
      { params },
    );
    return res.data.data;
  },

  createAnonymizeRequest: async (payload: { reason?: string }): Promise<UserLgpdRequest> => {
    const res = await api.post<{ success: boolean; data: UserLgpdRequest }>('/auth/me/lgpd/anonymize-request', payload);
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

// ── Tickets Metrics Types ─────────────────────────────────────────────────────

export interface TicketsMetricsParams {
  date_from: string;
  date_to:   string;
  agent_id?: string;
  category?: string;
}

export interface TicketsMetricsOverview {
  total:                number;
  open:                 number;
  inProgress:           number;
  waiting:              number;
  resolved:             number;
  closed:               number;
  avgResolutionMinutes: number;
}

export interface TicketsMetricsPeriodPoint {
  date:     string;
  opened:   number;
  resolved: number;
}

export interface TicketsMetricsByAgentPoint {
  agentId:              string;
  agentName:            string;
  total:                number;
  resolved:             number;
  avgResolutionMinutes: number;
  openNow:              number;
}

export interface TicketsMetricsByCategoryPoint {
  category:   string;
  count:      number;
  percentage: number;
}

export interface TicketsMetricsByTypePoint {
  type:       string;
  count:      number;
  percentage: number;
}

export interface TicketsMetricsData {
  overview:   TicketsMetricsOverview;
  byPeriod:   TicketsMetricsPeriodPoint[];
  byAgent:    TicketsMetricsByAgentPoint[];
  byCategory: TicketsMetricsByCategoryPoint[];
  byType:     TicketsMetricsByTypePoint[];
}

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
    const res = await api.delete<{ success: boolean; data: { deleted: boolean; id: string } }>(`/tickets/${id}`);
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

  getTimeline: async (ticketId: string): Promise<TicketTimelineEvent[]> => {
    const res = await api.get<{ success: boolean; data: TicketTimelineEvent[] }>(`/tickets/${ticketId}/timeline`);
    return res.data.data;
  },

  listRelations: async (ticketId: string): Promise<TicketRelation[]> => {
    const res = await api.get<{ success: boolean; data: TicketRelation[] }>(`/tickets/${ticketId}/relations`);
    return res.data.data;
  },

  addRelation: async (ticketId: string, data: AddTicketRelationPayload): Promise<void> => {
    await api.post(`/tickets/${ticketId}/relations`, data);
  },

  removeRelation: async (ticketId: string, relationId: string): Promise<void> => {
    await api.delete(`/tickets/${ticketId}/relations/${relationId}`);
  },

  search: async (q: string, exclude?: string): Promise<TicketSearchResult[]> => {
    const res = await api.get<{ success: boolean; data: TicketSearchResult[] }>('/tickets/search', {
      params: { q, ...(exclude ? { exclude } : {}) },
    });
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

  updateComment: async (ticketId: string, commentId: string, content: string): Promise<{ success: boolean }> => {
    const res = await api.patch<{ success: boolean }>(`/tickets/${ticketId}/comments/${commentId}`, { content });
    return res.data;
  },

  listAttachments: async (ticketId: string): Promise<TicketAttachment[]> => {
    const res = await api.get<{ success: boolean; data: TicketAttachment[] }>(`/tickets/${ticketId}/attachments`);
    return res.data.data;
  },

  uploadAttachment: async (ticketId: string, file: File, commentId?: string): Promise<TicketAttachment> => {
    const form = new FormData();
    form.append('file', file);
    if (commentId) {
      form.append('comment_id', commentId);
    }

    const res = await api.post<{ success: boolean; data: TicketAttachment }>(
      `/tickets/${ticketId}/attachments`,
      form,
    );
    return res.data.data;
  },

  deleteAttachment: async (attachmentId: string): Promise<{ deleted: boolean }> => {
    const res = await api.delete<{ success: boolean; data: { deleted: boolean } }>(
      `/tickets/attachments/${attachmentId}`,
    );
    return res.data.data;
  },

  downloadAttachment: async (attachmentId: string): Promise<Blob> => {
    const res = await api.get<Blob>(`/tickets/attachments/${attachmentId}/content`, {
      responseType: 'blob',
    });
    return res.data;
  },

  listChecklist: async (ticketId: string): Promise<TicketChecklistItem[]> => {
    const res = await api.get<{ success: boolean; data: TicketChecklistItem[] }>(
      `/tickets/${ticketId}/checklist`,
    );
    return res.data.data;
  },

  addChecklist: async (ticketId: string, title: string): Promise<TicketChecklistItem> => {
    const res = await api.post<{ success: boolean; data: TicketChecklistItem }>(
      `/tickets/${ticketId}/checklist`,
      { title },
    );
    return res.data.data;
  },

  updateChecklist: async (
    ticketId: string,
    itemId: string,
    data: Partial<{ title: string; is_done: boolean }>,
  ): Promise<TicketChecklistItem> => {
    const res = await api.patch<{ success: boolean; data: TicketChecklistItem }>(
      `/tickets/${ticketId}/checklist/${itemId}`,
      data,
    );
    return res.data.data;
  },

  deleteChecklist: async (ticketId: string, itemId: string): Promise<{ deleted: boolean }> => {
    const res = await api.delete<{ success: boolean; data: { deleted: boolean } }>(
      `/tickets/${ticketId}/checklist/${itemId}`,
    );
    return res.data.data;
  },

  listTimeEntries: async (ticketId: string): Promise<TicketTimeEntry[]> => {
    const res = await api.get<{ success: boolean; data: TicketTimeEntry[] }>(
      `/tickets/${ticketId}/time`,
    );
    return res.data.data;
  },

  addTimeEntry: async (ticketId: string, data: CreateTicketTimePayload): Promise<TicketTimeEntry> => {
    const res = await api.post<{ success: boolean; data: TicketTimeEntry }>(
      `/tickets/${ticketId}/time`,
      data,
    );
    return res.data.data;
  },

  deleteTimeEntry: async (ticketId: string, entryId: string): Promise<{ deleted: boolean }> => {
    const res = await api.delete<{ success: boolean; data: { deleted: boolean } }>(
      `/tickets/${ticketId}/time/${entryId}`,
    );
    return res.data.data;
  },

  getMetrics: async (params: TicketsMetricsParams): Promise<TicketsMetricsData> => {
    const res = await api.get<{ success: boolean; data: TicketsMetricsData }>('/tickets/metrics', { params });
    return res.data.data;
  },

  exportCsv: async (params?: ExportTicketsParams): Promise<Blob> => {
    const res = await api.get<Blob>('/tickets/export', {
      params: { format: 'csv', ...params },
      responseType: 'blob',
    });
    return res.data;
  },
};

export const ticketComments = {
  list: (ticketId: string) =>
    api.get<{ success: boolean; data: TicketComment[] }>(`/tickets/${ticketId}/comments`),

  create: (ticketId: string, data: CreateCommentPayload) =>
    api.post<{ success: boolean; data: TicketComment }>(`/tickets/${ticketId}/comments`, data),

  update: (ticketId: string, commentId: string, data: UpdateCommentPayload) =>
    api.patch<{ success: boolean }>(`/tickets/${ticketId}/comments/${commentId}`, data),

  delete: (ticketId: string, commentId: string) =>
    api.delete<{ success: boolean; data: { deleted: boolean } }>(`/tickets/${ticketId}/comments/${commentId}`),
};

export const ticketChecklist = {
  list: (ticketId: string) => api.get(`/tickets/${ticketId}/checklist`),
  add: (ticketId: string, title: string) => api.post(`/tickets/${ticketId}/checklist`, { title }),
  update: (ticketId: string, itemId: string, data: { title?: string; is_done?: boolean }) =>
    api.patch(`/tickets/${ticketId}/checklist/${itemId}`, data),
  delete: (ticketId: string, itemId: string) => api.delete(`/tickets/${ticketId}/checklist/${itemId}`),
};

export const ticketTime = {
  list: (ticketId: string) => api.get(`/tickets/${ticketId}/time`),
  add: (ticketId: string, data: { minutes: number; description?: string; worked_at?: string }) =>
    api.post(`/tickets/${ticketId}/time`, data),
  delete: (ticketId: string, entryId: string) => api.delete(`/tickets/${ticketId}/time/${entryId}`),
};

export const ticketRelations = {
  list: (ticketId: string) => api.get(`/tickets/${ticketId}/relations`),
  add: (ticketId: string, data: AddTicketRelationPayload) =>
    api.post(`/tickets/${ticketId}/relations`, data),
  remove: (ticketId: string, relationId: string) =>
    api.delete(`/tickets/${ticketId}/relations/${relationId}`),
};

export const ticketsSearch = (q: string, exclude?: string) =>
  api.get('/tickets/search', { params: { q, ...(exclude ? { exclude } : {}) } });

export interface PortalUser {
  id: string;
  name: string;
  email: string;
}

export interface PortalMe {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  role: string | null;
  department: string | null;
  organization_id: string | null;
  organization_name: string | null;
}

export interface PortalTicket {
  id: string;
  title: string;
  description?: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  type_id?: string | null;
  type_name?: string | null;
  type_icon?: string | null;
  type_color?: string | null;
  assigned_name?: string | null;
  contact_name?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface PortalTicketComment {
  id: string;
  content: string;
  created_at: string;
  user_name: string | null;
  role: string | null;
  source?: string | null;
}

export interface PortalTicketDetail extends PortalTicket {
  comments: PortalTicketComment[];
}

export type PortalLgpdConsentStatus = 'pending' | 'granted' | 'denied' | 'revoked';
export type PortalLgpdRequestType = 'access' | 'anonymization' | 'consent_update' | 'rectification';
export type PortalLgpdRequestStatus = 'pending' | 'processed' | 'rejected';

export interface PortalLgpdRequest {
  id: string;
  request_type: PortalLgpdRequestType | string;
  status: PortalLgpdRequestStatus | string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  requested_at: string;
  processed_at: string | null;
}

export interface PortalLgpdState {
  consent: {
    status: PortalLgpdConsentStatus | string;
    at: string | null;
    source: string | null;
    last_export_at: string | null;
    anonymized_at: string | null;
    anonymization_reason: string | null;
  };
  requests: PortalLgpdRequest[];
}

export interface LegalDpoInfo {
  name: string | null;
  email: string | null;
  phone: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  companyLegalName: string | null;
  companyCnpj: string | null;
}

function resolvePortalTenantSlug(): string {
  if (typeof window === 'undefined') return 'demo';
  const host = window.location.hostname.toLowerCase();
  const parts = host.split('.');
  if (parts[0] === 'suporte' && parts[1]) return parts[1];
  if (host === 'localhost' || host === '127.0.0.1') return 'demo';
  return 'demo';
}

const legalHttp = axios.create({
  baseURL: '/api/legal',
  withCredentials: false,
});

const portalHttp = axios.create({
  baseURL: '/api/portal',
  withCredentials: false,
});

function getPortalToken(): string | null {
  return localStorage.getItem('portal_token');
}

function withPortalAuth(config: AxiosRequestConfig = {}): AxiosRequestConfig {
  const token = getPortalToken();
  if (!token) return config;
  return {
    ...config,
    headers: {
      ...(config.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  };
}

export const portalApi = {
  login: async (email: string, password: string): Promise<{ token: string; contact: PortalUser }> => {
    const res = await portalHttp.post<{ success: boolean; token: string; contact: PortalUser }>('/auth/login', {
      email,
      password,
      tenant_slug: resolvePortalTenantSlug(),
    });
    return { token: res.data.token, contact: res.data.contact };
  },

  forgotPassword: async (email: string): Promise<void> => {
    await portalHttp.post('/auth/forgot-password', { email });
  },

  getMe: async (): Promise<PortalMe> => {
    const res = await portalHttp.get<{ success: boolean; data: PortalMe }>('/me', withPortalAuth());
    return res.data.data;
  },

  getTicketTypes: async (): Promise<Array<{ id: string; name: string; icon: string; color: string }>> => {
    const res = await portalHttp.get<{ success: boolean; data: Array<{ id: string; name: string; icon: string; color: string }> }>(
      '/ticket-types',
      withPortalAuth(),
    );
    return res.data.data;
  },

  getTickets: async (params?: { status?: TicketStatus; page?: number; per_page?: number }): Promise<{
    data: PortalTicket[];
    total: number;
    page: number;
    per_page: number;
  }> => {
    const res = await portalHttp.get<{
      success: boolean;
      data: PortalTicket[];
      total: number;
      page: number;
      per_page: number;
    }>('/tickets', withPortalAuth({ ...(params ? { params } : {}) }));
    return {
      data: res.data.data,
      total: res.data.total,
      page: res.data.page,
      per_page: res.data.per_page,
    };
  },

  getTicket: async (id: string): Promise<PortalTicketDetail> => {
    const res = await portalHttp.get<{ success: boolean; data: PortalTicketDetail }>(`/tickets/${id}`, withPortalAuth());
    return res.data.data;
  },

  createTicket: async (payload: { title: string; description?: string; type_id?: string }): Promise<PortalTicket> => {
    const res = await portalHttp.post<{ success: boolean; data: PortalTicket }>('/tickets', payload, withPortalAuth());
    return res.data.data;
  },

  addComment: async (ticketId: string, content: string): Promise<void> => {
    await portalHttp.post(`/tickets/${ticketId}/comments`, { content }, withPortalAuth());
  },

  getLgpdState: async (): Promise<PortalLgpdState> => {
    const res = await portalHttp.get<{ success: boolean; data: PortalLgpdState }>('/lgpd', withPortalAuth());
    return res.data.data;
  },

  updateLgpdConsent: async (payload: { status: PortalLgpdConsentStatus; source?: string }): Promise<{
    status: PortalLgpdConsentStatus | string;
    consent_at: string | null;
    source: string | null;
    request_id: string;
  }> => {
    const res = await portalHttp.patch<{
      success: boolean;
      data: {
        status: PortalLgpdConsentStatus | string;
        consent_at: string | null;
        source: string | null;
        request_id: string;
      };
    }>('/lgpd/consent', payload, withPortalAuth());
    return res.data.data;
  },

  createLgpdRequest: async (payload: {
    request_type: Extract<PortalLgpdRequestType, 'access' | 'anonymization'>;
    reason?: string;
    include_messages?: boolean;
  }): Promise<{
    id: string;
    request_type: PortalLgpdRequestType | string;
    status: PortalLgpdRequestStatus | string;
    requested_at: string;
  }> => {
    const res = await portalHttp.post<{
      success: boolean;
      data: {
        id: string;
        request_type: PortalLgpdRequestType | string;
        status: PortalLgpdRequestStatus | string;
        requested_at: string;
      };
    }>('/lgpd/requests', payload, withPortalAuth());
    return res.data.data;
  },
  requestContactDataRectification: async (payload: {
    name?: string;
    email?: string;
    phone?: string;
    document?: string;
  }): Promise<{
    id: string;
    request_type: PortalLgpdRequestType | string;
    status: PortalLgpdRequestStatus | string;
    requested_at: string;
  }> => {
    const res = await portalHttp.patch<{
      success: boolean;
      data: {
        id: string;
        request_type: PortalLgpdRequestType | string;
        status: PortalLgpdRequestStatus | string;
        requested_at: string;
      };
    }>('/lgpd/contact-data', payload, withPortalAuth());
    return res.data.data;
  },
};

export const legalApi = {
  getDpo: async (): Promise<LegalDpoInfo> => {
    const res = await legalHttp.get<LegalDpoInfo>('/dpo');
    return res.data;
  },
};
