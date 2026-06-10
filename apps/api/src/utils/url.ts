import { env } from '../config/env.js';

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
