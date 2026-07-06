import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { decryptCredentials } from '../utils/crypto.js';

const APP_SECRETS_CACHE_TTL_S = 60;
const CHANNEL_CACHE_TTL_S = 60;

function applyWhatsAppEnvFallback(credentials: Record<string, string>): Record<string, string> {
  const get = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = credentials[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };
  return {
    ...credentials,
    phoneNumberId: get('phoneNumberId', 'phone_number_id') ?? env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: get('wabaId', 'waba_id') ?? env.WHATSAPP_WABA_ID,
    accessToken: get('accessToken', 'access_token') ?? env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: get('verifyToken', 'verify_token') ?? env.WHATSAPP_VERIFY_TOKEN,
  };
}

type FastifyRequestWithRawBody = FastifyRequest & {
  rawBody?: Buffer;
};

function hasValidSignature(rawBody: Buffer, signature: string, appSecret: string): boolean {
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return (
    signatureBuffer.length === expectedBuffer.length
    && timingSafeEqual(signatureBuffer, expectedBuffer)
  );
}

function extractWhatsAppIdentifiers(body: unknown): {
  phoneNumberIds: Set<string>;
  wabaIds: Set<string>;
} {
  const phoneNumberIds = new Set<string>();
  const wabaIds = new Set<string>();
  if (!body || typeof body !== 'object') return { phoneNumberIds, wabaIds };

  const entries = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return { phoneNumberIds, wabaIds };

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const wabaId = (entry as { id?: unknown }).id;
    if (typeof wabaId === 'string' && wabaId) wabaIds.add(wabaId);

    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== 'object') continue;
      const metadata = (value as { metadata?: unknown }).metadata;
      if (!metadata || typeof metadata !== 'object') continue;
      const phoneNumberId = (metadata as { phone_number_id?: unknown }).phone_number_id;
      if (typeof phoneNumberId === 'string' && phoneNumberId) {
        phoneNumberIds.add(phoneNumberId);
      }
    }
  }

  return { phoneNumberIds, wabaIds };
}

async function resolveWhatsAppAppSecrets(body: unknown): Promise<string[]> {
  const { phoneNumberIds, wabaIds } = extractWhatsAppIdentifiers(body);
  if (phoneNumberIds.size === 0 && wabaIds.size === 0) return [];

  // Per-phoneNumberId cache: safe across tests (each test uses a unique phoneId)
  const firstPhoneId = [...phoneNumberIds][0];
  if (firstPhoneId) {
    try {
      const cached = await redis.get(`whatsapp:app-secrets:${firstPhoneId}`);
      if (cached) return JSON.parse(cached) as string[];
    } catch {
      // cache miss or Redis unavailable — continue with DB scan
    }
  }

  const tenants = await prisma.$queryRawUnsafe<Array<{ id: string; schema_name: string }>>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );
  const secrets = new Set<string>();

  for (const tenant of tenants) {
    if (!/^[a-z0-9_]+$/.test(tenant.schema_name)) continue;
    let channels: Array<{ id: string; credentials: string | object }>;
    try {
      channels = await prisma.$queryRawUnsafe<Array<{ id: string; credentials: string | object }>>(
        `SELECT id, credentials
           FROM "${tenant.schema_name}".channels
          WHERE type = 'whatsapp' AND status = 'active'`,
      );
    } catch {
      continue;
    }

    for (const channel of channels) {
      let credentials: Record<string, string>;
      try {
        credentials = decryptCredentials(channel.credentials);
      } catch {
        continue;
      }
      const phoneId = (credentials.phoneNumberId ?? credentials.phone_number_id ?? '').trim();
      const wabaId = (credentials.wabaId ?? credentials.waba_id ?? '').trim();
      const matches = (
        Boolean(phoneId && phoneNumberIds.has(phoneId))
        || Boolean(wabaId && wabaIds.has(wabaId))
      );
      if (!matches) continue;

      const appSecret = credentials.appSecret ?? credentials.app_secret ?? env.META_APP_SECRET;
      if (appSecret) secrets.add(appSecret);

      // Populate channel cache so findChannelByPhoneNumberId gets a cache hit on the same request
      if (phoneId && phoneNumberIds.has(phoneId)) {
        const channelMatch = {
          tenantId: tenant.id,
          schemaName: tenant.schema_name,
          channelId: channel.id,
          channelCredentials: applyWhatsAppEnvFallback(credentials),
        };
        try {
          await redis.set(
            `whatsapp:channel:${phoneId}`,
            JSON.stringify(channelMatch),
            'EX',
            CHANNEL_CACHE_TTL_S,
          );
        } catch {
          // silent
        }
      }
    }
  }

  const result = Array.from(secrets);
  if (firstPhoneId && result.length > 0) {
    try {
      await redis.set(
        `whatsapp:app-secrets:${firstPhoneId}`,
        JSON.stringify(result),
        'EX',
        APP_SECRETS_CACHE_TTL_S,
      );
    } catch {
      // silent
    }
  }
  return result;
}

export async function verifyMetaSignature(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const signatureHeader = request.headers['x-hub-signature-256'];
  const signature = typeof signatureHeader === 'string' ? signatureHeader : undefined;

  if (!signature) {
    void reply.status(401).send({
      success: false,
      error: { code: 'MISSING_SIGNATURE', message: 'Missing x-hub-signature-256 header' },
    });
    return;
  }

  const rawBody = (request as FastifyRequestWithRawBody).rawBody;
  if (!rawBody) {
    void reply.status(400).send({
      success: false,
      error: { code: 'MISSING_BODY', message: 'Raw body unavailable' },
    });
    return;
  }

  if (!hasValidSignature(rawBody, signature, env.META_APP_SECRET)) {
    request.log.warn('Invalid Meta webhook signature');
    void reply.status(401).send({
      success: false,
      error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' },
    });
  }
}

export async function verifyWhatsAppMetaSignature(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const signatureHeader = request.headers['x-hub-signature-256'];
  const signature = typeof signatureHeader === 'string' ? signatureHeader : undefined;
  const rawBody = (request as FastifyRequestWithRawBody).rawBody;

  if (!signature || !rawBody) {
    void reply.status(signature ? 400 : 401).send({
      success: false,
      error: {
        code: signature ? 'MISSING_BODY' : 'MISSING_SIGNATURE',
        message: signature ? 'Raw body unavailable' : 'Missing x-hub-signature-256 header',
      },
    });
    return;
  }

  const appSecrets = await resolveWhatsAppAppSecrets(request.body);
  if (appSecrets.length === 0) {
    appSecrets.push(env.META_APP_SECRET);
  }
  if (!appSecrets.some((appSecret) => hasValidSignature(rawBody, signature, appSecret))) {
    request.log.warn('Invalid WhatsApp webhook signature');
    void reply.status(401).send({
      success: false,
      error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' },
    });
  }
}
