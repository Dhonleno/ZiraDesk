import { useMemo } from 'react';
import { usePiiPermission } from './usePiiPermission';
import { maskDocument, maskEmail, maskPhone } from '../utils/pii-mask';

interface PiiInput {
  email?: string | null;
  phone?: string | null;
  document?: string | null;
}

interface PiiValues {
  email: string | null;
  phone: string | null;
  document: string | null;
}

export function usePiiMask(input: PiiInput): {
  canViewFull: boolean;
  masked: PiiValues;
  full: PiiValues;
} {
  const { hasFullPii: canViewFull } = usePiiPermission();

  const masked = useMemo<PiiValues>(() => ({
    email: maskEmail(input.email ?? null),
    phone: maskPhone(input.phone ?? null),
    document: maskDocument(input.document ?? null),
  }), [input.document, input.email, input.phone]);

  const full = useMemo<PiiValues>(() => ({
    email: canViewFull ? (input.email ?? null) : masked.email,
    phone: canViewFull ? (input.phone ?? null) : masked.phone,
    document: canViewFull ? (input.document ?? null) : masked.document,
  }), [canViewFull, input.document, input.email, input.phone, masked.document, masked.email, masked.phone]);

  return { canViewFull, masked, full };
}

