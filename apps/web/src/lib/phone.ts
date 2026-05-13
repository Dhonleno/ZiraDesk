import { isValidPhoneNumber } from 'libphonenumber-js';

export function isValidOptionalPhone(value?: string | null): boolean {
  if (!value) return true;

  try {
    return isValidPhoneNumber(value);
  } catch {
    return false;
  }
}
