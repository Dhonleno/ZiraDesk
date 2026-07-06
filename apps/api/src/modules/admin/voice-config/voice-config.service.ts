import { prisma } from '../../../config/database.js';
import { ensureTenantVoiceConfigInfrastructure } from '../../super-admin/tenants/tenants.service.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { UpdateVoiceConfigInput } from './voice-config.schema.js';

interface TenantVoiceConfigRow {
  id: string;
  tenant_id: string;
  twilio_phone_number: string;
  default_bot_menu_id: string | null;
  ivr_enabled: boolean;
  ring_timeout_seconds: number;
  created_at: Date;
  updated_at: Date;
}

interface TenantVoiceConfigLookupRow extends TenantVoiceConfigRow {
  schema_name: string;
}

export interface TenantVoiceConfig {
  id: string;
  tenantId: string;
  twilioPhoneNumber: string;
  defaultBotMenuId: string | null;
  ivrEnabled: boolean;
  ringTimeoutSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantVoiceConfigLookup {
  tenantId: string;
  schemaName: string;
  config: TenantVoiceConfig;
}

export class DuplicateTwilioPhoneNumberError extends Error {
  constructor() {
    super('Este número já está em uso por outro tenant');
    this.name = 'DuplicateTwilioPhoneNumberError';
  }
}

export class InvalidBotMenuError extends Error {
  constructor() {
    super('Menu do bot não encontrado neste tenant');
    this.name = 'InvalidBotMenuError';
  }
}

function mapRow(row: TenantVoiceConfigRow): TenantVoiceConfig {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    twilioPhoneNumber: row.twilio_phone_number,
    defaultBotMenuId: row.default_bot_menu_id,
    ivrEnabled: row.ivr_enabled,
    ringTimeoutSeconds: row.ring_timeout_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: string;
    message?: string;
    meta?: { code?: string; message?: string };
  };
  return candidate.code === '23505'
    || candidate.meta?.code === '23505'
    || candidate.message?.includes('duplicate key value') === true
    || candidate.meta?.message?.includes('duplicate key value') === true;
}

async function getTenantSchemaName(tenantId: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ schema_name: string }>>(
    `SELECT schema_name
       FROM public.tenants
      WHERE id = $1
      LIMIT 1`,
    tenantId,
  );
  const schemaName = rows[0]?.schema_name;
  if (!schemaName) {
    throw new Error('Tenant não encontrado');
  }
  return schemaName;
}

async function validateBotMenu(tenantId: string, botMenuId: string | null): Promise<void> {
  if (!botMenuId) return;

  const schemaName = await getTenantSchemaName(tenantId);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
       FROM ${quoteIdent(schemaName)}.bot_menus
      WHERE id = $1::uuid
      LIMIT 1`,
    botMenuId,
  );
  if (!rows[0]) {
    throw new InvalidBotMenuError();
  }
}

export async function getVoiceConfig(tenantId: string): Promise<TenantVoiceConfig | null> {
  await ensureTenantVoiceConfigInfrastructure();
  const rows = await prisma.$queryRawUnsafe<TenantVoiceConfigRow[]>(
    `SELECT id, tenant_id, twilio_phone_number, default_bot_menu_id, ivr_enabled,
            ring_timeout_seconds, created_at, updated_at
       FROM public.tenant_voice_config
      WHERE tenant_id = $1
      LIMIT 1`,
    tenantId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function upsertVoiceConfig(
  tenantId: string,
  data: UpdateVoiceConfigInput,
): Promise<TenantVoiceConfig> {
  await ensureTenantVoiceConfigInfrastructure();
  const current = await getVoiceConfig(tenantId);
  const defaultBotMenuId = data.defaultBotMenuId === undefined
    ? (current?.defaultBotMenuId ?? null)
    : data.defaultBotMenuId;

  await validateBotMenu(tenantId, defaultBotMenuId);

  try {
    const rows = await prisma.$queryRawUnsafe<TenantVoiceConfigRow[]>(
      `INSERT INTO public.tenant_voice_config (
         tenant_id,
         twilio_phone_number,
         default_bot_menu_id,
         ivr_enabled,
         ring_timeout_seconds
       )
       VALUES ($1, $2, $3::uuid, $4, $5)
       ON CONFLICT (tenant_id) DO UPDATE SET
         twilio_phone_number = EXCLUDED.twilio_phone_number,
         default_bot_menu_id = EXCLUDED.default_bot_menu_id,
         ivr_enabled = EXCLUDED.ivr_enabled,
         ring_timeout_seconds = EXCLUDED.ring_timeout_seconds,
         updated_at = NOW()
       RETURNING id, tenant_id, twilio_phone_number, default_bot_menu_id, ivr_enabled,
                 ring_timeout_seconds, created_at, updated_at`,
      tenantId,
      data.twilioPhoneNumber,
      defaultBotMenuId,
      data.ivrEnabled ?? current?.ivrEnabled ?? true,
      data.ringTimeoutSeconds ?? current?.ringTimeoutSeconds ?? 20,
    );

    const row = rows[0];
    if (!row) throw new Error('Falha ao salvar configuração de voz');
    return mapRow(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateTwilioPhoneNumberError();
    }
    throw error;
  }
}

export async function getTenantByTwilioNumber(
  phoneNumber: string,
): Promise<TenantVoiceConfigLookup | null> {
  await ensureTenantVoiceConfigInfrastructure();
  const rows = await prisma.$queryRawUnsafe<TenantVoiceConfigLookupRow[]>(
    `SELECT vc.id, vc.tenant_id, t.schema_name, vc.twilio_phone_number,
            vc.default_bot_menu_id, vc.ivr_enabled, vc.ring_timeout_seconds,
            vc.created_at, vc.updated_at
       FROM public.tenant_voice_config vc
       JOIN public.tenants t ON t.id = vc.tenant_id
      WHERE vc.twilio_phone_number = $1
        AND t.status = 'active'
      LIMIT 1`,
    phoneNumber,
  );

  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    schemaName: row.schema_name,
    config: mapRow(row),
  };
}
