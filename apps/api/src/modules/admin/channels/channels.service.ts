import { prisma } from '../../../config/database.js';
import { env } from '../../../config/env.js';
import { decryptCredentials, encryptCredentials } from '../../../utils/crypto.js';
import { hasTenantEmailProvider } from '../../../services/email.service.js';
import type { CreateChannelInput, UpdateChannelInput } from './channels.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ChannelConfigurationError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 502 = 400,
  ) {
    super(message);
    this.name = 'ChannelConfigurationError';
  }
}

function validateSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }

  return schemaName;
}

function channelsTable(schemaName: string): string {
  return `"${validateSchemaName(schemaName)}".channels`;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  credentials: string | object;
  status: string;
  settings: unknown;
  last_tested_at: Date | null;
  last_test_ok: boolean | null;
  created_at: Date;
}

interface ChannelRowPublic {
  id: string;
  type: string;
  name: string;
  status: string;
  settings: unknown;
  last_tested_at: Date | null;
  last_test_ok: boolean | null;
  created_at: Date;
}

interface NgrokTunnel {
  public_url?: unknown;
  proto?: unknown;
  config?: {
    addr?: unknown;
  };
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractMetaErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const top = payload as { error?: unknown };
  if (!top.error || typeof top.error !== 'object') return null;
  const nested = top.error as { message?: unknown };
  return typeof nested.message === 'string' ? nested.message.trim() : null;
}

async function ensureChannelsInfrastructure(schemaName: string): Promise<void> {
  const tableRef = channelsTable(schemaName);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${tableRef} (
       id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
       type        VARCHAR(30)  NOT NULL,
       name        VARCHAR(100) NOT NULL,
       credentials JSONB        NOT NULL DEFAULT '{}',
       status      VARCHAR(20)  NOT NULL DEFAULT 'active',
       settings    JSONB        NOT NULL DEFAULT '{}',
       created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ${tableRef}
       ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ${tableRef}
       ADD COLUMN IF NOT EXISTS last_test_ok BOOLEAN`,
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readMetaResponse(response: Response, fallbackMessage: string): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ChannelConfigurationError(
      extractMetaErrorMessage(payload) ?? fallbackMessage,
      response.status >= 500 ? 502 : 400,
    );
  }

  return payload;
}

async function requestMeta(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...init.headers,
        },
      },
    );
  } catch {
    throw new ChannelConfigurationError('Não foi possível conectar à Meta para validar o canal', 502);
  }

  return readMetaResponse(response, `Falha na configuração do WhatsApp (HTTP ${response.status})`);
}

async function resolveTokenAppId(
  accessToken: string,
  appId: string,
  appSecret: string,
): Promise<string> {
  const appAccessToken = `${appId}|${appSecret}`;
  const payload = await requestMeta(
    `debug_token?input_token=${encodeURIComponent(accessToken)}`,
    appAccessToken,
  ) as { data?: { app_id?: unknown; is_valid?: unknown } };
  const resolvedAppId = asTrimmedString(payload.data?.app_id);

  if (payload.data?.is_valid !== true || !resolvedAppId) {
    throw new ChannelConfigurationError('Access Token do WhatsApp inválido');
  }

  return resolvedAppId;
}

function isNgrokTunnelForApi(tunnel: NgrokTunnel): boolean {
  const publicUrl = asTrimmedString(tunnel.public_url);
  const proto = asTrimmedString(tunnel.proto);
  const addr = asTrimmedString(tunnel.config?.addr).toLowerCase();
  const port = String(env.PORT);

  return (
    proto === 'https'
    && publicUrl.startsWith('https://')
    && (
      addr === `http://localhost:${port}`
      || addr === `https://localhost:${port}`
      || addr === `http://127.0.0.1:${port}`
      || addr === `https://127.0.0.1:${port}`
    )
  );
}

async function detectDevelopmentNgrokUrl(): Promise<string | null> {
  if (env.NODE_ENV !== 'development') return null;

  try {
    const response = await fetchWithTimeout('http://127.0.0.1:4040/api/tunnels', {}, 2_000);
    if (!response.ok) return null;

    const payload = await response.json() as { tunnels?: NgrokTunnel[] };
    const tunnel = payload.tunnels?.find(isNgrokTunnelForApi);
    return asTrimmedString(tunnel?.public_url) || null;
  } catch {
    return null;
  }
}

async function whatsappWebhookUrl(): Promise<string> {
  const detectedNgrokUrl = await detectDevelopmentNgrokUrl();
  if (detectedNgrokUrl) {
    return `${detectedNgrokUrl.replace(/\/+$/, '')}/api/webhooks/whatsapp`;
  }

  const apiUrl = asTrimmedString(env.API_URL);
  if (!apiUrl) {
    throw new ChannelConfigurationError(
      'URL pública da API não configurada no servidor',
      502,
    );
  }
  return `${apiUrl.replace(/\/+$/, '')}/api/webhooks/whatsapp`;
}

async function validateAndConfigureWhatsAppChannel(
  credentials: Record<string, unknown>,
): Promise<void> {
  const phoneNumberId = asTrimmedString(
    credentials.phoneNumberId ?? credentials.phone_number_id ?? env.WHATSAPP_PHONE_NUMBER_ID,
  );
  const wabaId = asTrimmedString(
    credentials.wabaId ?? credentials.waba_id ?? env.WHATSAPP_WABA_ID,
  );
  const accessToken = asTrimmedString(
    credentials.accessToken ?? credentials.access_token ?? env.WHATSAPP_ACCESS_TOKEN,
  );
  const appId = asTrimmedString(credentials.appId ?? credentials.app_id);
  const appSecret = asTrimmedString(credentials.appSecret ?? credentials.app_secret);

  if (!phoneNumberId || !wabaId || !accessToken || !appId || !appSecret) {
    throw new ChannelConfigurationError('Credenciais WhatsApp incompletas');
  }

  if (!/^\d+$/.test(phoneNumberId)) {
    throw new ChannelConfigurationError('Phone Number ID deve conter apenas números');
  }
  if (!/^\d+$/.test(wabaId)) {
    throw new ChannelConfigurationError('WABA ID deve conter apenas números');
  }
  if (!/^\d+$/.test(appId)) {
    throw new ChannelConfigurationError('App ID deve conter apenas números');
  }

  const tokenAppId = await resolveTokenAppId(accessToken, appId, appSecret);
  if (tokenAppId !== appId) {
    throw new ChannelConfigurationError(
      'O Access Token não pertence ao App ID informado.',
    );
  }

  const callbackUrl = await whatsappWebhookUrl();
  const subscribedFields = [
    'messages',
    'message_template_components_update',
    'message_template_quality_update',
    'message_template_status_update',
    'phone_number_name_update',
    'phone_number_quality_update',
    'account_alerts',
    'account_review_update',
    'account_update',
    'security',
  ];
  await requestMeta(
    `${encodeURIComponent(appId)}/subscriptions`,
    `${appId}|${appSecret}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        object: 'whatsapp_business_account',
        callback_url: callbackUrl,
        verify_token: env.WHATSAPP_VERIFY_TOKEN,
        fields: subscribedFields.join(','),
      }),
    },
  );

  await requestMeta(`${encodeURIComponent(wabaId)}?fields=id`, accessToken);
  const phoneNumbers = await requestMeta(
    `${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`,
    accessToken,
  ) as { data?: Array<{ id?: unknown }> };
  const phoneBelongsToWaba = phoneNumbers.data?.some(
    (phone) => asTrimmedString(phone.id) === phoneNumberId,
  );
  if (!phoneBelongsToWaba) {
    throw new ChannelConfigurationError('O Phone Number ID não pertence à WABA informada');
  }

  await requestMeta(
    `${encodeURIComponent(wabaId)}/subscribed_apps`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        override_callback_uri: callbackUrl,
        verify_token: env.WHATSAPP_VERIFY_TOKEN,
      }),
    },
  );
  await requestMeta(
    `${encodeURIComponent(phoneNumberId)}`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook_configuration: {
          override_callback_uri: callbackUrl,
          verify_token: env.WHATSAPP_VERIFY_TOKEN,
        },
      }),
    },
  );

  const phone = await requestMeta(
    `${encodeURIComponent(phoneNumberId)}?fields=id,webhook_configuration`,
    accessToken,
  ) as { webhook_configuration?: { application?: unknown } };
  if (asTrimmedString(phone.webhook_configuration?.application) !== callbackUrl) {
    throw new ChannelConfigurationError(
      'A Meta não confirmou o callback de entrada do WhatsApp',
      502,
    );
  }
}

async function testInstagramChannel(credentials: Record<string, unknown>): Promise<void> {
  const pageId = asTrimmedString(credentials.page_id ?? credentials.pageId);
  const accessToken = asTrimmedString(credentials.access_token ?? credentials.accessToken);

  if (!pageId || !accessToken) {
    throw new Error('Credenciais Instagram incompletas');
  }

  const response = await fetchWithTimeout(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(pageId)}?fields=id`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    let message = `Falha na validação do Instagram (HTTP ${response.status})`;
    try {
      const payload = await response.json() as unknown;
      message = extractMetaErrorMessage(payload) ?? message;
    } catch {
      // noop
    }
    throw new Error(message);
  }
}

async function testEmailChannel(schemaName: string): Promise<void> {
  const providerConfigured = await hasTenantEmailProvider(schemaName);
  if (!providerConfigured) {
    throw new Error('Provedor de e-mail não configurado');
  }
}

export async function listChannels(schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `SELECT id, type, name, status, settings, last_tested_at, last_test_ok, created_at
       FROM ${tableRef}
      ORDER BY created_at DESC`,
  );
  return rows;
}

export async function getChannel(id: string, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, type, name, credentials, status, settings, last_tested_at, last_test_ok, created_at
       FROM ${tableRef}
      WHERE id = $1::uuid
      LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Canal');
  const { credentials, ...rest } = rows[0];
  const decrypted = decryptCredentials(credentials);
  const {
    accessToken: _accessToken,
    access_token: _legacyAccessToken,
    appSecret: _appSecret,
    app_secret: _legacyAppSecret,
    ...publicCredentials
  } = decrypted;
  return {
    ...rest,
    credentials: {
      ...publicCredentials,
      hasAccessToken: Boolean(_accessToken || _legacyAccessToken),
      hasAppSecret: Boolean(_appSecret || _legacyAppSecret),
    },
  };
}

export async function createChannel(data: CreateChannelInput, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  if (data.type === 'whatsapp') {
    await validateAndConfigureWhatsAppChannel(data.credentials);
  }
  const encryptedCredentials = encryptCredentials(data.credentials);
  const credentialsJson = JSON.stringify(encryptedCredentials);
  const settingsJson = JSON.stringify(data.settings ?? {});

  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `INSERT INTO ${tableRef} (type, name, credentials, settings)
     VALUES ($1, $2, $3::jsonb, $4::jsonb)
     RETURNING id, type, name, status, settings, last_tested_at, last_test_ok, created_at`,
    data.type,
    data.name,
    credentialsJson,
    settingsJson,
  );
  return rows[0]!;
}

export async function updateChannel(id: string, data: UpdateChannelInput, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const existingRows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, type, credentials, settings, last_tested_at, last_test_ok
       FROM ${tableRef}
      WHERE id = $1::uuid
      LIMIT 1`,
    id,
  );
  if (!existingRows[0]) throw new NotFoundError('Canal');

  const currentCredentials = decryptCredentials(existingRows[0].credentials);
  const incomingCredentials = data.credentials ?? {};
  const mergedCredentials = data.credentials
    ? { ...currentCredentials, ...incomingCredentials }
    : currentCredentials;

  if (
    data.credentials
    && (!Object.prototype.hasOwnProperty.call(data.credentials, 'accessToken')
      || !String(data.credentials.accessToken ?? '').trim())
    && currentCredentials.accessToken
  ) {
    mergedCredentials.accessToken = currentCredentials.accessToken;
  }
  if (
    data.credentials
    && (!Object.prototype.hasOwnProperty.call(data.credentials, 'appSecret')
      || !String(data.credentials.appSecret ?? '').trim())
    && currentCredentials.appSecret
  ) {
    mergedCredentials.appSecret = currentCredentials.appSecret;
  }

  if (existingRows[0].type === 'whatsapp' && data.credentials) {
    await validateAndConfigureWhatsAppChannel(mergedCredentials);
  }

  const encryptedCredentials = encryptCredentials(mergedCredentials);
  const credentialsJson = JSON.stringify(encryptedCredentials);

  const currentSettings = (existingRows[0].settings as Record<string, unknown>) ?? {};
  const mergedSettings = data.settings ? { ...currentSettings, ...data.settings } : currentSettings;

  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `UPDATE ${tableRef}
     SET name        = COALESCE($1, name),
         credentials = $2::jsonb,
         settings    = $3::jsonb,
         status      = COALESCE($4, status)
     WHERE id = $5::uuid
     RETURNING id, type, name, status, settings, last_tested_at, last_test_ok, created_at`,
    data.name ?? null,
    credentialsJson,
    JSON.stringify(mergedSettings),
    data.status ?? null,
    id,
  );
  return rows[0]!;
}

export async function deleteChannel(id: string, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRowPublic[]>(
    `UPDATE ${tableRef}
        SET status = 'inactive',
            last_test_ok = false,
            last_tested_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, type, name, status, settings, last_tested_at, last_test_ok, created_at`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Canal');
  return rows[0];
}

export async function testChannel(id: string, schemaName: string) {
  const tableRef = channelsTable(schemaName);
  await ensureChannelsInfrastructure(schemaName);
  const rows = await prisma.$queryRawUnsafe<ChannelRow[]>(
    `SELECT id, type, name, credentials, status, settings, last_tested_at, last_test_ok, created_at
       FROM ${tableRef}
      WHERE id = $1::uuid
      LIMIT 1`,
    id,
  );
  const channel = rows[0];
  if (!channel) throw new NotFoundError('Canal');

  const credentials = decryptCredentials(channel.credentials) as Record<string, unknown>;

  let connected = false;

  try {
    switch (channel.type) {
      case 'whatsapp':
        await validateAndConfigureWhatsAppChannel(credentials);
        connected = true;
        break;
      case 'instagram':
        await testInstagramChannel(credentials);
        connected = true;
        break;
      case 'email':
        await testEmailChannel(schemaName);
        connected = true;
        break;
      case 'webchat':
        connected = true;
        break;
      default:
        throw new Error('Tipo de canal não suportado para teste');
    }
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${tableRef}
          SET last_tested_at = NOW(),
              last_test_ok = false
        WHERE id = $1::uuid`,
      id,
    );
    throw error;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE ${tableRef}
        SET last_tested_at = NOW(),
            last_test_ok = $2
      WHERE id = $1::uuid`,
    id,
    connected,
  );

  return { connected, channel_id: id };
}
