import { prisma } from '../../../config/database.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { UpdateSettingsInput } from './settings.schema.js';

const LOGO_DIR = path.resolve(process.cwd(), 'public', 'uploads', 'logos');

const LOGO_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const DEFAULT_INACTIVITY_WARNING_MESSAGE =
  'Olá! Notamos que você está inativo há {{time}}. Seu atendimento será encerrado em {{remaining}} minutos caso não haja interação.';
const DEFAULT_INACTIVITY_CLOSE_MESSAGE =
  'Seu atendimento foi encerrado por inatividade. Caso precise de ajuda, entre em contato novamente. 😊';
const DEFAULT_ACTIVE_OUTBOUND_VALIDITY_MODE = 'end_of_day';
const DEFAULT_ACTIVE_OUTBOUND_VALIDITY_HOURS = 24;
const DEFAULT_BOT_ASSIGNED_MESSAGE = [
  '✅ Seu atendimento foi aceito!',
  '',
  'Você está sendo atendido por *{{agent}}*.',
  'Em breve entraremos em contato. 😊',
].join('\n');

async function ensureLogoDir() {
  await fs.mkdir(LOGO_DIR, { recursive: true });
}

function logoFileName(tenantId: string, mimeType: string): string {
  const ext = LOGO_EXT_BY_MIME[mimeType] ?? 'png';
  return `${tenantId}.${ext}`;
}

async function removeOldLogos(tenantId: string, keepFileName: string) {
  await ensureLogoDir();
  const files = await fs.readdir(LOGO_DIR);
  await Promise.all(
    files
      .filter((file) => file.startsWith(`${tenantId}.`) && file !== keepFileName)
      .map(async (file) => {
        await fs.rm(path.join(LOGO_DIR, file), { force: true });
      }),
  );
}

function resolveLogoPath(fileName: string): string | null {
  if (!/^[a-zA-Z0-9-]+\.(png|jpg|webp|svg)$/.test(fileName)) return null;
  return path.join(LOGO_DIR, fileName);
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

export async function readLogoFile(fileName: string): Promise<Buffer | null> {
  const resolved = resolveLogoPath(fileName);
  if (!resolved) return null;

  try {
    return await fs.readFile(resolved);
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
      plan: { select: { id: true, name: true, slug: true, priceMonth: true } },
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
  };
}

export async function uploadLogo(params: {
  tenantId: string;
  fileBuffer: Buffer;
  mimeType: string;
}) {
  const fileName = logoFileName(params.tenantId, params.mimeType);
  const fullPath = path.join(LOGO_DIR, fileName);
  await ensureLogoDir();
  await removeOldLogos(params.tenantId, fileName);
  await fs.writeFile(fullPath, params.fileBuffer);

  const tenant = await prisma.tenant.findUnique({
    where: { id: params.tenantId },
    select: { settings: true },
  });
  if (!tenant) throw new Error('Tenant não encontrado');

  const current = (tenant.settings as Record<string, unknown>) ?? {};
  const logoUrl = `/api/admin/settings/logo/${fileName}?v=${Date.now()}`;

  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: {
      settings: {
        ...current,
        logo_url: logoUrl,
      },
    },
  });

  return { logo_url: logoUrl };
}
