import { env } from '../../../config/env.js';

export type TemplateMediaHeaderType = 'image' | 'video' | 'document';

interface MediaRule {
  headerType: TemplateMediaHeaderType;
  maxBytes: number;
}

const MEDIA_RULES: Record<string, MediaRule> = {
  'image/jpeg': { headerType: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/png': { headerType: 'image', maxBytes: 5 * 1024 * 1024 },
  'video/mp4': { headerType: 'video', maxBytes: 16 * 1024 * 1024 },
  'application/pdf': { headerType: 'document', maxBytes: 100 * 1024 * 1024 },
};

interface MetaUploadSessionResponse {
  id?: string;
  error?: {
    message?: string;
  };
}

interface MetaHeaderHandleResponse {
  h?: string;
  error?: {
    message?: string;
  };
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function validateTemplateMedia(
  mimeType: string,
  sizeBytes: number,
): TemplateMediaHeaderType {
  const rule = MEDIA_RULES[mimeType];
  if (!rule) {
    throw new Error('Formato inválido. Use JPEG, PNG, MP4 ou PDF.');
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('O arquivo enviado está vazio.');
  }
  if (sizeBytes > rule.maxBytes) {
    const maxMb = Math.floor(rule.maxBytes / (1024 * 1024));
    throw new Error(`O arquivo excede o limite de ${maxMb}MB para ${rule.headerType}.`);
  }
  return rule.headerType;
}

export async function uploadHeaderHandle(
  file: Buffer,
  mimeType: string,
  filename: string,
  wabaId: string,
  accessToken: string,
): Promise<string> {
  validateTemplateMedia(mimeType, file.byteLength);

  if (!filename.trim()) throw new Error('Nome do arquivo ausente.');
  if (!wabaId.trim() || !accessToken.trim()) {
    throw new Error('Credenciais da Meta incompletas para upload.');
  }

  const sessionParams = new URLSearchParams({
    file_length: String(file.byteLength),
    file_type: mimeType,
    access_token: accessToken,
  });

  let sessionResponse: Response;
  try {
    sessionResponse = await fetch(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(wabaId)}/uploads?${sessionParams.toString()}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new Error('Não foi possível iniciar o upload de mídia na Meta.');
  }

  const sessionText = await sessionResponse.text();
  const sessionPayload = parseJson<MetaUploadSessionResponse>(sessionText);
  const uploadSessionId = sessionPayload?.id?.trim();
  if (!sessionResponse.ok || !uploadSessionId) {
    throw new Error('A Meta não autorizou o início do upload de mídia.');
  }

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(uploadSessionId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        body: file,
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch {
    throw new Error('Não foi possível enviar o arquivo para a Meta.');
  }

  const uploadText = await uploadResponse.text();
  const uploadPayload = parseJson<MetaHeaderHandleResponse>(uploadText);
  const headerHandle = uploadPayload?.h?.trim();
  if (!uploadResponse.ok || !headerHandle) {
    throw new Error('A Meta não concluiu o upload da mídia.');
  }

  return headerHandle;
}
