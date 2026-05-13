export class PhoneNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneNormalizationError';
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeBrazilNationalDigits(nationalDigits: string): string {
  if (!/^\d{10,11}$/.test(nationalDigits)) {
    throw new PhoneNormalizationError('Número BR inválido: use DDD + número (10 ou 11 dígitos).');
  }

  const ddd = nationalDigits.slice(0, 2);
  if (ddd.startsWith('0')) {
    throw new PhoneNormalizationError('DDD inválido para número brasileiro.');
  }

  if (nationalDigits.length === 10) {
    const subscriber = nationalDigits.slice(2);
    const first = subscriber.charAt(0);

    // Móvel BR sem nono dígito (legado): adiciona 9 automaticamente.
    if (['6', '7', '8', '9'].includes(first)) {
      return `55${ddd}9${subscriber}`;
    }

    // Fixo BR: mantém 8 dígitos do assinante.
    return `55${ddd}${subscriber}`;
  }

  return `55${nationalDigits}`;
}

function normalizeInternationalDigits(digits: string): string {
  if (digits.length < 8 || digits.length > 15) {
    throw new PhoneNormalizationError('Número internacional inválido (precisa ter entre 8 e 15 dígitos).');
  }

  return digits;
}

export function normalizePhoneForStorage(value?: string | null): string | null {
  if (value === null || value === undefined) return null;

  const raw = value.trim();
  if (!raw) return null;

  const hasPlusPrefix = raw.startsWith('+');
  const hasInternationalExit = raw.startsWith('00');
  const digits = digitsOnly(raw);

  if (!digits) return null;

  let normalizedDigits: string;

  if (hasPlusPrefix) {
    normalizedDigits = normalizeInternationalDigits(digits);
  } else if (hasInternationalExit) {
    normalizedDigits = normalizeInternationalDigits(digits.slice(2));
  } else if (digits.length === 10) {
    // Sem DDI explícito e 10 dígitos -> padrão Brasil (DDD + número).
    normalizedDigits = normalizeBrazilNationalDigits(digits);
  } else if (digits.length === 11) {
    // 11 dígitos sem +:
    // - se 3º dígito for 9, tratamos como BR móvel (DDD + 9 dígitos)
    // - caso contrário, tratamos como internacional (ex.: NANP +1...)
    normalizedDigits = digits.charAt(2) === '9'
      ? normalizeBrazilNationalDigits(digits)
      : normalizeInternationalDigits(digits);
  } else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    // Brasil já com DDI sem símbolo +.
    normalizedDigits = normalizeBrazilNationalDigits(digits.slice(2));
  } else {
    // Sem +, mas claramente internacional (ex.: NANP com 11 dígitos iniciando em 1).
    normalizedDigits = normalizeInternationalDigits(digits);
  }

  return `+${normalizedDigits}`;
}

export function normalizeWhatsAppSenderPhone(senderPhone: string): string {
  const raw = senderPhone.trim();
  if (!raw) throw new PhoneNormalizationError('Telefone do remetente vazio.');

  const hasPlusPrefix = raw.startsWith('+');
  const digits = digitsOnly(raw);
  if (!digits) throw new PhoneNormalizationError('Telefone do remetente inválido.');

  return hasPlusPrefix ? `+${digits}` : `+${digits}`;
}
