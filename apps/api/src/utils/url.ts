import { env } from '../config/env.js';

// URL do portal do cliente. Espelha a regra já usada em
// portal.service.ts:resolvePortalResetUrl (produção → suporte.{slug}, fora dela
// → APP_URL), com PORTAL_URL como override explícito quando o deploy expõe o
// portal em outro host.
export function buildPortalUrl(slug: string, path: string): string {
  if (env.PORTAL_URL) {
    return `${env.PORTAL_URL.replace(/\/$/, '')}${path}`;
  }

  if (env.NODE_ENV === 'production') {
    return `https://suporte.${slug}.ziradesk.com${path}`;
  }

  return `${env.APP_URL.replace(/\/$/, '')}${path}`;
}

export function buildTenantUrl(slug: string, path: string): string {
  const base = env.APP_URL.replace(/\/$/, '');
  const url = new URL(base);

  if (url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    return `${base}${path}`;
  }

  const parts = url.hostname.split('.');
  const domain = parts.slice(-2).join('.');
  url.hostname = `${slug}.${domain}`;
  url.pathname = '';
  url.search = '';
  return `${url.origin}${path}`;
}
