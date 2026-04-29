import { prisma } from '../../../config/database.js';
import { decryptCredentials } from '../../../utils/crypto.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'audio/webm',
  'video/mp4',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_FILE_SIZE = 16 * 1024 * 1024;

type SupportedMediaType = 'image' | 'audio' | 'video' | 'document';

interface MetaChannelCredentials {
  phoneNumberId: string;
  accessToken: string;
}

interface MetaMediaInfoCache {
  url: string;
  mime_type?: string | undefined;
  file_size?: number | undefined;
  expires_at: number;
}

const mediaInfoCache = new Map<string, MetaMediaInfoCache>();

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function getSchemaPrefix(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });
  if (!tenant) throw new Error('Tenant não encontrado');
  return `${quoteIdent(tenant.schemaName)}.`;
}

function normalizeMediaType(mimeType: string): SupportedMediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

async function getMetaCredentialsForConversation(
  tenantId: string,
  conversationId: string,
): Promise<MetaChannelCredentials> {
  const schemaPrefix = await getSchemaPrefix(tenantId);
  const rows = await prisma.$queryRawUnsafe<Array<{ credentials: unknown }>>(
    `SELECT ch.credentials
     FROM ${schemaPrefix}conversations c
     JOIN ${schemaPrefix}channels ch ON ch.id = c.channel_id
     WHERE c.id = $1::uuid AND ch.type = 'whatsapp' AND ch.status = 'active'
     LIMIT 1`,
    conversationId,
  );

  if (!rows[0]) {
    throw new Error('Canal WhatsApp ativo não encontrado para a conversa');
  }

  const creds = decryptCredentials(rows[0].credentials as string | object) as Record<string, string>;
  const phoneNumberId = creds.phoneNumberId;
  const accessToken = creds.accessToken;
  if (!phoneNumberId || !accessToken) {
    throw new Error('Credenciais WhatsApp inválidas');
  }

  return { phoneNumberId, accessToken };
}

export function validateMediaInput(mimeType: string, sizeBytes: number) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('Tipo de arquivo não suportado');
  }
  if (sizeBytes > MAX_FILE_SIZE) {
    throw new Error('Arquivo excede o limite de 16MB');
  }
}

export async function uploadToMeta(
  file: Buffer,
  mimeType: string,
  filename: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([file], { type: mimeType });
  form.append('file', blob, filename);
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);

  const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  const result = (await response.json()) as { id?: string };
  if (!response.ok || !result?.id) {
    throw new Error(`Meta media upload error: ${JSON.stringify(result)}`);
  }
  return result.id as string;
}

export async function uploadConversationMedia(params: {
  tenantId: string;
  conversationId: string;
  file: Buffer;
  mimeType: string;
  filename: string;
  sizeBytes: number;
}) {
  validateMediaInput(params.mimeType, params.sizeBytes);
  const creds = await getMetaCredentialsForConversation(params.tenantId, params.conversationId);
  const mediaId = await uploadToMeta(
    params.file,
    params.mimeType,
    params.filename,
    creds.phoneNumberId,
    creds.accessToken,
  );

  return {
    media_id: mediaId,
    media_type: normalizeMediaType(params.mimeType),
    filename: params.filename,
    size: params.sizeBytes,
  };
}

export async function getMetaMediaInfo(params: {
  tenantId: string;
  conversationId: string;
  mediaId: string;
}) {
  const cacheKey = `${params.tenantId}:${params.mediaId}`;
  const cached = mediaInfoCache.get(cacheKey);
  if (cached && cached.expires_at > Date.now()) {
    return cached;
  }

  const creds = await getMetaCredentialsForConversation(params.tenantId, params.conversationId);
  const response = await fetch(`https://graph.facebook.com/v19.0/${params.mediaId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
    },
  });
  const result = (await response.json()) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
  };
  if (!response.ok || !result?.url) {
    throw new Error(`Meta media info error: ${JSON.stringify(result)}`);
  }

  const info: MetaMediaInfoCache = {
    url: result.url as string,
    mime_type: result.mime_type as string | undefined,
    file_size: result.file_size as number | undefined,
    expires_at: Date.now() + 60 * 60 * 1000,
  };
  mediaInfoCache.set(cacheKey, info);
  return info;
}

export async function downloadMetaMedia(params: {
  tenantId: string;
  conversationId: string;
  mediaId: string;
}) {
  const info = await getMetaMediaInfo(params);
  const creds = await getMetaCredentialsForConversation(params.tenantId, params.conversationId);

  const response = await fetch(info.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta media download error: ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: info.mime_type ?? response.headers.get('content-type') ?? 'application/octet-stream',
    contentLength: info.file_size ?? Number(response.headers.get('content-length') ?? 0),
  };
}
