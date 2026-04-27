import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

export type SupportedLanguage = 'pt-BR' | 'en-US' | 'es';

const SUPPORTED: SupportedLanguage[] = ['pt-BR', 'en-US', 'es'];
const FALLBACK: SupportedLanguage = 'pt-BR';

declare module 'fastify' {
  interface FastifyRequest {
    language: SupportedLanguage;
  }
}

function resolveLanguage(acceptLanguage: string | undefined): SupportedLanguage {
  if (!acceptLanguage) return FALLBACK;

  // Parseia "pt-BR,pt;q=0.9,en;q=0.8" em ordem de preferência
  const candidates = acceptLanguage
    .split(',')
    .map((part) => part.trim().split(';')[0]?.trim() ?? '')
    .filter(Boolean);

  for (const candidate of candidates) {
    // Correspondência exata
    if (SUPPORTED.includes(candidate as SupportedLanguage)) {
      return candidate as SupportedLanguage;
    }
    // Correspondência por prefixo de idioma (ex: "en" → "en-US", "pt" → "pt-BR")
    const prefix = candidate.split('-')[0]?.toLowerCase();
    const match = SUPPORTED.find((lang) => lang.toLowerCase().startsWith(prefix ?? ''));
    if (match) return match;
  }

  return FALLBACK;
}

export function languageMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  request.language = resolveLanguage(request.headers['accept-language']);
  done();
}
