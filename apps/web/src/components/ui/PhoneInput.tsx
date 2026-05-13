import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  parsePhoneNumberFromString as parsePhoneNumber,
  type CountryCode,
} from 'libphonenumber-js';

interface PhoneInputProps {
  value: string;
  onChange: (value: string, isValid: boolean) => void;
  country?: string | undefined;
  placeholder?: string | undefined;
  error?: string | undefined;
}

interface CountryOption {
  code: CountryCode;
  dialCode: string;
  label: string;
  flag: string;
}

const PRIORITY_COUNTRIES: CountryCode[] = ['BR', 'US', 'PT', 'AR', 'ES'];

const COUNTRY_NAME_OVERRIDES: Partial<Record<CountryCode, string>> = {
  AR: 'Argentina',
  BR: 'Brasil',
  ES: 'Espanha',
  PT: 'Portugal',
  US: 'Estados Unidos',
};

function getFlagEmoji(countryCode: CountryCode): string {
  return countryCode
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function buildCountryOptions(locale: string): CountryOption[] {
  const displayNames = typeof Intl.DisplayNames !== 'undefined'
    ? new Intl.DisplayNames([locale], { type: 'region' })
    : null;

  const options = getCountries().map((code) => {
    const translated = displayNames?.of(code);
    const label = COUNTRY_NAME_OVERRIDES[code] ?? translated ?? code;
    return {
      code,
      dialCode: `+${getCountryCallingCode(code)}`,
      label,
      flag: getFlagEmoji(code),
    };
  });

  const priority = PRIORITY_COUNTRIES
    .map((code) => options.find((option) => option.code === code))
    .filter((option): option is CountryOption => Boolean(option));

  const rest = options
    .filter((option) => !PRIORITY_COUNTRIES.includes(option.code))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  return [...priority, ...rest];
}

function resolveCountryCode(code?: string): CountryCode {
  const upper = (code ?? 'BR').toUpperCase();
  if (upper.length !== 2) return 'BR';

  const countries = getCountries();
  return countries.includes(upper as CountryCode) ? (upper as CountryCode) : 'BR';
}

function validateBrazilPhone(e164Value: string): { valid: boolean; invalidBrPattern: boolean } {
  const digits = e164Value.replace(/\D/g, '');
  if (!digits.startsWith('55')) return { valid: false, invalidBrPattern: false };

  const national = digits.slice(2);
  if (national.length !== 10 && national.length !== 11) return { valid: false, invalidBrPattern: true };

  const ddd = national.slice(0, 2);
  if (ddd.startsWith('0')) return { valid: false, invalidBrPattern: true };

  if (national.length === 11 && national.charAt(2) !== '9') {
    return { valid: false, invalidBrPattern: true };
  }

  return { valid: isValidPhoneNumber(e164Value), invalidBrPattern: false };
}

function validatePhone(e164Value: string, countryCode: CountryCode): { valid: boolean; invalidBrPattern: boolean } {
  if (!e164Value) return { valid: true, invalidBrPattern: false };

  try {
    if (countryCode === 'BR') return validateBrazilPhone(e164Value);
    return { valid: isValidPhoneNumber(e164Value), invalidBrPattern: false };
  } catch {
    return { valid: false, invalidBrPattern: false };
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function stripSelectedCountryCallingCode(raw: string, country: CountryCode): string {
  const digits = digitsOnly(raw);
  if (!digits) return '';

  const callingCode = getCountryCallingCode(country);

  // Se usuário digitar com +DDI ou com DDI puro (ex.: 5562... com BR),
  // removemos o DDI para manter apenas o número nacional no campo.
  if ((raw.trim().startsWith('+') || digits.startsWith(callingCode)) && digits.startsWith(callingCode)) {
    const national = digits.slice(callingCode.length);
    if (national.length > 0) return national;
  }

  return digits;
}

function formatNational(nationalDigits: string, country: CountryCode): string {
  const formatter = new AsYouType(country);
  return formatter.input(nationalDigits);
}

function parseE164FromNational(nationalDigits: string, country: CountryCode): string {
  if (!nationalDigits) return '';

  const parsed = parsePhoneNumber(nationalDigits, country);
  if (parsed) {
    return parsed.format('E.164');
  }

  const callingCode = getCountryCallingCode(country);
  return `+${callingCode}${nationalDigits}`;
}

function parseValidityFromNational(nationalDigits: string, country: CountryCode): { valid: boolean; invalidBrPattern: boolean } {
  const e164 = parseE164FromNational(nationalDigits, country);
  return validatePhone(e164, country);
}

function toStateValue(inputValue: string, fallbackCountry: CountryCode): { selectedCountry: CountryCode; formattedLocal: string; e164: string } {
  const raw = inputValue.trim();
  if (!raw) {
    return { selectedCountry: fallbackCountry, formattedLocal: '', e164: '' };
  }

  const parsed = parsePhoneNumber(raw) ?? parsePhoneNumberFromString(raw, fallbackCountry);
  if (parsed) {
    const selectedCountry = parsed.country ?? fallbackCountry;
    const nationalDigits = digitsOnly(parsed.nationalNumber);

    return {
      selectedCountry,
      formattedLocal: formatNational(nationalDigits, selectedCountry),
      e164: parsed.format('E.164'),
    };
  }

  const nationalDigits = stripSelectedCountryCallingCode(raw, fallbackCountry);
  const formattedLocal = formatNational(nationalDigits, fallbackCountry);
  const e164 = parseE164FromNational(nationalDigits, fallbackCountry);

  return { selectedCountry: fallbackCountry, formattedLocal, e164 };
}

export function PhoneInput({
  value,
  onChange,
  country = 'BR',
  placeholder,
  error,
}: PhoneInputProps) {
  const { t, i18n } = useTranslation('common');
  const defaultCountry = resolveCountryCode(country);
  const countryOptions = useMemo(() => buildCountryOptions(i18n.language), [i18n.language]);

  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(defaultCountry);
  const [displayValue, setDisplayValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    const next = toStateValue(value, defaultCountry);
    setSelectedCountry(next.selectedCountry);
    setDisplayValue(next.formattedLocal);
  }, [defaultCountry, value]);

  useEffect(() => {
    if (!value) {
      setTouched(false);
      setLocalError('');
    }
  }, [value]);

  function emit(nextDisplayValue: string, nextCountry: CountryCode, forceValidation: boolean) {
    const nationalDigits = stripSelectedCountryCallingCode(nextDisplayValue, nextCountry);
    const e164 = parseE164FromNational(nationalDigits, nextCountry);
    const result = parseValidityFromNational(nationalDigits, nextCountry);
    const shouldValidate = forceValidation || touched;
    const isValid = !e164 || !shouldValidate || result.valid;

    if (shouldValidate && e164 && !result.valid) {
      setLocalError(result.invalidBrPattern ? t('phone.invalidBR') : t('phone.invalid'));
    } else {
      setLocalError('');
    }

    onChange(e164, isValid);
  }

  function handleCountryChange(nextCountryRaw: string) {
    const nextCountry = resolveCountryCode(nextCountryRaw);
    const nationalDigits = stripSelectedCountryCallingCode(displayValue, selectedCountry);
    const formatted = formatNational(nationalDigits, nextCountry);
    setSelectedCountry(nextCountry);
    setDisplayValue(formatted);
    emit(formatted, nextCountry, false);
  }

  function handleInputChange(rawValue: string) {
    const nationalDigits = stripSelectedCountryCallingCode(rawValue, selectedCountry);
    const formatted = formatNational(nationalDigits, selectedCountry);
    setDisplayValue(formatted);
    emit(formatted, selectedCountry, false);
  }

  function handleBlur() {
    setFocused(false);
    setTouched(true);
    emit(displayValue, selectedCountry, true);
  }

  const visibleError = error || localError;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          border: `1px solid ${visibleError ? '#EF4444' : focused ? 'var(--teal)' : 'var(--line)'}`,
          borderRadius: 'var(--r)',
          overflow: 'hidden',
        }}
      >
        <select
          value={selectedCountry}
          onChange={(event) => handleCountryChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={t('phone.selectCountry')}
          style={{
            background: 'var(--bg-2)',
            border: 'none',
            borderRight: '1px solid var(--line)',
            borderRadius: 'var(--r) 0 0 var(--r)',
            padding: '0 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 13,
            color: 'var(--txt)',
            fontFamily: 'var(--font)',
            height: '2.5rem',
            minWidth: 112,
          }}
        >
          {countryOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.flag} {option.dialCode}
            </option>
          ))}
        </select>

        <input
          type="tel"
          value={displayValue}
          onChange={(event) => handleInputChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          style={{
            border: 'none',
            borderLeft: 'none',
            borderRadius: '0 var(--r) var(--r) 0',
            flex: 1,
            background: 'var(--bg-3)',
            color: 'var(--txt)',
            fontFamily: 'var(--font)',
            fontSize: 13,
            height: '2.5rem',
            padding: '0 12px',
            outline: 'none',
          }}
        />
      </div>

      {visibleError && (
        <p style={{ color: '#EF4444', fontSize: 12, marginTop: 4 }}>
          {visibleError}
        </p>
      )}
    </div>
  );
}
