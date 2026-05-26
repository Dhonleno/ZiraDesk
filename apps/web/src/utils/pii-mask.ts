function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const at = trimmed.indexOf('@');
  if (at <= 0) return '***';

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain) return `${local.charAt(0) || '*'}***@***`;

  return `${local.charAt(0) || '*'}***@${domain}`;
}

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = digitsOnly(value);
  if (!digits) return null;

  const country = digits.length > 11 ? digits.slice(0, digits.length - 11) : '';
  const local = digits.length > 11 ? digits.slice(-11) : digits;

  if (local.length < 10) {
    if (digits.length <= 4) return `****${digits}`;
    return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }

  const area = local.slice(0, 2);
  const body = local.slice(2);
  const prefix = body.slice(0, Math.max(1, body.length - 4));
  const suffix = body.slice(-4);
  const visiblePrefix = prefix.charAt(0);
  const hidden = '*'.repeat(Math.max(1, prefix.length - 1));
  const countryPrefix = country ? `+${country} ` : '';

  return `${countryPrefix}(${area}) ${visiblePrefix}${hidden}-${suffix}`;
}

export function maskDocument(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = digitsOnly(value);
  if (!digits) return null;

  if (digits.length === 11) {
    return `***.***.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  }

  if (digits.length === 14) {
    return `**.***.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  }

  if (digits.length <= 4) {
    return '*'.repeat(digits.length);
  }

  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

