import { prisma } from '../../../config/database.js';
import type { UpdateSettingsInput } from './settings.schema.js';

export async function getSettings(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
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
    created_at: tenant.createdAt,
    plan: tenant.plan,
  };
}

export async function updateSettings(tenantId: string, data: UpdateSettingsInput) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, settings: true },
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
  };

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: data.name ?? tenant.name,
      settings: merged,
    },
    select: { id: true, name: true, settings: true },
  });

  const s = (updated.settings as Record<string, unknown>) ?? {};
  return {
    id: updated.id,
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
  };
}
