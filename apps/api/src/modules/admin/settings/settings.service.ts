import { prisma } from '../../../config/database.js';
import { getStorage } from '../../../lib/storage/index.js';
import type { UpdateSettingsInput } from './settings.schema.js';

const LOGO_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const LOGO_ALL_EXTS = ['png', 'jpg', 'webp', 'svg'] as const;

const DEFAULT_INACTIVITY_WARNING_MESSAGE =
  'Olá! Notamos que você está inativo há {{time}}. Seu atendimento será encerrado em {{remaining}} minutos caso não haja interação.';
const DEFAULT_INACTIVITY_CLOSE_MESSAGE =
  'Seu atendimento foi encerrado por inatividade. Caso precise de ajuda, entre em contato novamente. 😊';
const DEFAULT_ACTIVE_OUTBOUND_VALIDITY_MODE = 'end_of_day';
const DEFAULT_ACTIVE_OUTBOUND_VALIDITY_HOURS = 24;
const DEFAULT_LGPD_RETENTION_DAYS = 180;
const DEFAULT_BOT_ASSIGNED_MESSAGE = [
  '✅ Seu atendimento foi aceito!',
  '',
  'Você está sendo atendido por *{{agent}}*.',
  'Em breve entraremos em contato. 😊',
].join('\n');

const DEFAULT_QUEUE_MESSAGE_TEMPLATE =
  'Você é o nº {{position}} na fila. Aguarde, em breve um agente irá atendê-lo.';
const DEFAULT_AGENT_ASSUME_TEMPLATE =
  'Olá! Meu nome é {{agent_name}}, vou continuar seu atendimento. Em que posso ajudar?';
const DEFAULT_EXPIRE_24H_MESSAGE =
  'Olá, infelizmente não conseguimos atender no momento. Por favor, entre em contato novamente quando puder.';

function logoKey(tenantId: string, mimeType: string): string {
  const ext = LOGO_EXT_BY_MIME[mimeType] ?? 'png';
  return `logos/${tenantId}.${ext}`;
}

async function deleteOldLogos(tenantId: string, keepKey: string): Promise<void> {
  const storage = getStorage();
  await Promise.allSettled(
    LOGO_ALL_EXTS.map((ext) => {
      const key = `logos/${tenantId}.${ext}`;
      return key !== keepKey ? storage.delete(key) : Promise.resolve();
    }),
  );
}

function resolveActiveOutboundValidityMode(value: unknown): 'end_of_day' | 'hours' {
  return value === 'hours' ? 'hours' : DEFAULT_ACTIVE_OUTBOUND_VALIDITY_MODE;
}

function resolveActiveOutboundValidityHours(value: unknown): number {
  if (typeof value !== 'number') return DEFAULT_ACTIVE_OUTBOUND_VALIDITY_HOURS;
  const parsed = Math.trunc(value);
  if (parsed < 1 || parsed > 168) return DEFAULT_ACTIVE_OUTBOUND_VALIDITY_HOURS;
  return parsed;
}

function resolveLgpdRetentionDays(value: unknown): number {
  if (typeof value !== 'number') return DEFAULT_LGPD_RETENTION_DAYS;
  const parsed = Math.trunc(value);
  if (parsed < 1 || parsed > 3650) return DEFAULT_LGPD_RETENTION_DAYS;
  return parsed;
}

export async function readLogoFile(fileName: string): Promise<Buffer | null> {
  if (!/^[a-zA-Z0-9-]+\.(png|jpg|webp|svg)$/.test(fileName)) return null;
  try {
    return await getStorage().download(`logos/${fileName}`);
  } catch {
    return null;
  }
}

export function logoMimeTypeFromFileName(fileName: string): string {
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg')) return 'image/jpeg';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

export async function getSettings(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      slug: true,
      name: true,
      settings: true,
      createdAt: true,
      plan: { select: { id: true, name: true, slug: true, priceMonth: true, features: true } },
    },
  });
  if (!tenant) throw new Error('Tenant não encontrado');
  const s = (tenant.settings as Record<string, unknown>) ?? {};
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    logo_url: (s.logo_url as string | undefined) ?? null,
    primary_color: (s.primary_color as string | undefined) ?? null,
    timezone: (s.timezone as string | undefined) ?? 'America/Sao_Paulo',
    language: (s.language as string | undefined) ?? 'pt-BR',
    away_message:
      (s.away_message as string | undefined) ??
      'Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 🕐',
    away_message_enabled: (s.away_message_enabled as boolean | undefined) ?? true,
    csat_enabled: (s.csat_enabled as boolean | undefined) ?? true,
    csat_message: (s.csat_message as string | undefined) ?? null,
    csat_expiration_hours: typeof s.csatExpirationHours === 'number' ? Math.trunc(s.csatExpirationHours) : 48,
    email_confirmation: (s.email_confirmation as boolean | undefined) ?? true,
    inactivity_enabled: (s.inactivity_enabled as boolean | undefined) ?? true,
    inactivity_warning_minutes: (s.inactivity_warning_minutes as number | undefined) ?? 30,
    inactivity_close_minutes: (s.inactivity_close_minutes as number | undefined) ?? 60,
    inactivity_warning_message:
      (s.inactivity_warning_message as string | undefined) ?? DEFAULT_INACTIVITY_WARNING_MESSAGE,
    inactivity_close_message:
      (s.inactivity_close_message as string | undefined) ?? DEFAULT_INACTIVITY_CLOSE_MESSAGE,
    active_outbound_validity_mode: resolveActiveOutboundValidityMode(s.active_outbound_validity_mode),
    active_outbound_validity_hours: resolveActiveOutboundValidityHours(s.active_outbound_validity_hours),
    bot_assigned_message:
      (s.bot_assigned_message as string | undefined) ?? DEFAULT_BOT_ASSIGNED_MESSAGE,
    max_conversations_per_agent:
      typeof s.max_conversations_per_agent === 'number' ? s.max_conversations_per_agent : null,
    lgpd_retention_enabled: (s.lgpd_retention_enabled as boolean | undefined) ?? false,
    lgpd_retention_days: resolveLgpdRetentionDays(s.lgpd_retention_days),
    queue_notifications_enabled: (s.queue_notifications_enabled as boolean | undefined) ?? true,
    queue_message_template: (s.queue_message_template as string | undefined) ?? DEFAULT_QUEUE_MESSAGE_TEMPLATE,
    queue_throttle_seconds: typeof s.queue_throttle_seconds === 'number' ? Math.trunc(s.queue_throttle_seconds) : 60,
    agent_assume_template: (s.agent_assume_template as string | undefined) ?? DEFAULT_AGENT_ASSUME_TEMPLATE,
    expire_24h_action: (s.expire_24h_action as 'close' | 'keep_open' | undefined) ?? 'close',
    expire_24h_message: (s.expire_24h_message as string | undefined) ?? DEFAULT_EXPIRE_24H_MESSAGE,
    created_at: tenant.createdAt,
    plan: tenant.plan,
  };
}

export async function updateSettings(tenantId: string, data: UpdateSettingsInput) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true, name: true, settings: true },
  });
  if (!tenant) throw new Error('Tenant não encontrado');

  const current = (tenant.settings as Record<string, unknown>) ?? {};
  const merged = {
    ...current,
    ...(data.logo_url !== undefined ? { logo_url: data.logo_url } : {}),
    ...(data.primary_color !== undefined ? { primary_color: data.primary_color } : {}),
    ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
    ...(data.language !== undefined ? { language: data.language } : {}),
    ...(data.away_message !== undefined ? { away_message: data.away_message } : {}),
    ...(data.away_message_enabled !== undefined
      ? { away_message_enabled: data.away_message_enabled }
      : {}),
    ...(data.csat_enabled !== undefined ? { csat_enabled: data.csat_enabled } : {}),
    ...(data.csat_message !== undefined ? { csat_message: data.csat_message } : {}),
    ...(data.csat_expiration_hours !== undefined ? { csatExpirationHours: data.csat_expiration_hours } : {}),
    ...(data.email_confirmation !== undefined ? { email_confirmation: data.email_confirmation } : {}),
    ...(data.inactivity_enabled !== undefined ? { inactivity_enabled: data.inactivity_enabled } : {}),
    ...(data.inactivity_warning_minutes !== undefined
      ? { inactivity_warning_minutes: data.inactivity_warning_minutes }
      : {}),
    ...(data.inactivity_close_minutes !== undefined
      ? { inactivity_close_minutes: data.inactivity_close_minutes }
      : {}),
    ...(data.inactivity_warning_message !== undefined
      ? { inactivity_warning_message: data.inactivity_warning_message }
      : {}),
    ...(data.inactivity_close_message !== undefined
      ? { inactivity_close_message: data.inactivity_close_message }
      : {}),
    ...(data.active_outbound_validity_mode !== undefined
      ? { active_outbound_validity_mode: data.active_outbound_validity_mode }
      : {}),
    ...(data.active_outbound_validity_hours !== undefined
      ? { active_outbound_validity_hours: data.active_outbound_validity_hours }
      : {}),
    ...(data.bot_assigned_message !== undefined
      ? { bot_assigned_message: data.bot_assigned_message }
      : {}),
    ...('max_conversations_per_agent' in data
      ? { max_conversations_per_agent: data.max_conversations_per_agent ?? null }
      : {}),
    ...(data.lgpd_retention_enabled !== undefined
      ? { lgpd_retention_enabled: data.lgpd_retention_enabled }
      : {}),
    ...(data.lgpd_retention_days !== undefined
      ? { lgpd_retention_days: data.lgpd_retention_days }
      : {}),
    ...(data.queue_notifications_enabled !== undefined
      ? { queue_notifications_enabled: data.queue_notifications_enabled }
      : {}),
    ...(data.queue_message_template !== undefined
      ? { queue_message_template: data.queue_message_template }
      : {}),
    ...(data.queue_throttle_seconds !== undefined
      ? { queue_throttle_seconds: data.queue_throttle_seconds }
      : {}),
    ...(data.agent_assume_template !== undefined
      ? { agent_assume_template: data.agent_assume_template }
      : {}),
    ...(data.expire_24h_action !== undefined
      ? { expire_24h_action: data.expire_24h_action }
      : {}),
    ...(data.expire_24h_message !== undefined
      ? { expire_24h_message: data.expire_24h_message }
      : {}),
  };

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: data.name ?? tenant.name,
      settings: merged,
    },
    select: { id: true, slug: true, name: true, settings: true },
  });

  const s = (updated.settings as Record<string, unknown>) ?? {};
  return {
    id: updated.id,
    slug: updated.slug,
    name: updated.name,
    logo_url: (s.logo_url as string | undefined) ?? null,
    primary_color: (s.primary_color as string | undefined) ?? null,
    timezone: (s.timezone as string | undefined) ?? 'America/Sao_Paulo',
    language: (s.language as string | undefined) ?? 'pt-BR',
    away_message:
      (s.away_message as string | undefined) ??
      'Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 🕐',
    away_message_enabled: (s.away_message_enabled as boolean | undefined) ?? true,
    csat_enabled: (s.csat_enabled as boolean | undefined) ?? true,
    csat_message: (s.csat_message as string | undefined) ?? null,
    csat_expiration_hours: typeof s.csatExpirationHours === 'number' ? Math.trunc(s.csatExpirationHours) : 48,
    email_confirmation: (s.email_confirmation as boolean | undefined) ?? true,
    inactivity_enabled: (s.inactivity_enabled as boolean | undefined) ?? true,
    inactivity_warning_minutes: (s.inactivity_warning_minutes as number | undefined) ?? 30,
    inactivity_close_minutes: (s.inactivity_close_minutes as number | undefined) ?? 60,
    inactivity_warning_message:
      (s.inactivity_warning_message as string | undefined) ?? DEFAULT_INACTIVITY_WARNING_MESSAGE,
    inactivity_close_message:
      (s.inactivity_close_message as string | undefined) ?? DEFAULT_INACTIVITY_CLOSE_MESSAGE,
    active_outbound_validity_mode: resolveActiveOutboundValidityMode(s.active_outbound_validity_mode),
    active_outbound_validity_hours: resolveActiveOutboundValidityHours(s.active_outbound_validity_hours),
    bot_assigned_message:
      (s.bot_assigned_message as string | undefined) ?? DEFAULT_BOT_ASSIGNED_MESSAGE,
    max_conversations_per_agent:
      typeof s.max_conversations_per_agent === 'number' ? s.max_conversations_per_agent : null,
    lgpd_retention_enabled: (s.lgpd_retention_enabled as boolean | undefined) ?? false,
    lgpd_retention_days: resolveLgpdRetentionDays(s.lgpd_retention_days),
    queue_notifications_enabled: (s.queue_notifications_enabled as boolean | undefined) ?? true,
    queue_message_template: (s.queue_message_template as string | undefined) ?? DEFAULT_QUEUE_MESSAGE_TEMPLATE,
    queue_throttle_seconds: typeof s.queue_throttle_seconds === 'number' ? Math.trunc(s.queue_throttle_seconds) : 60,
    agent_assume_template: (s.agent_assume_template as string | undefined) ?? DEFAULT_AGENT_ASSUME_TEMPLATE,
    expire_24h_action: (s.expire_24h_action as 'close' | 'keep_open' | undefined) ?? 'close',
    expire_24h_message: (s.expire_24h_message as string | undefined) ?? DEFAULT_EXPIRE_24H_MESSAGE,
  };
}

export async function uploadLogo(params: {
  tenantId: string;
  fileBuffer: Buffer;
  mimeType: string;
}) {
  const key = logoKey(params.tenantId, params.mimeType);
  await deleteOldLogos(params.tenantId, key);
  const logoUrl = await getStorage().upload(key, params.fileBuffer, params.mimeType);

  const tenant = await prisma.tenant.findUnique({
    where: { id: params.tenantId },
    select: { settings: true },
  });
  if (!tenant) throw new Error('Tenant não encontrado');

  const current = (tenant.settings as Record<string, unknown>) ?? {};

  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: { settings: { ...current, logo_url: logoUrl } },
  });

  return { logo_url: logoUrl };
}
