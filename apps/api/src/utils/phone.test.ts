import { describe, expect, it } from 'vitest';
import { normalizePhoneForStorage } from './phone.js';

describe('normalizePhoneForStorage', () => {
  it('adiciona o nono dígito para celular BR de 12 dígitos (com 55)', () => {
    expect(normalizePhoneForStorage('556285669658')).toBe('+5562985669658');
  });

  it('mantém celular BR já com 9 (13 dígitos)', () => {
    expect(normalizePhoneForStorage('5562985669658')).toBe('+5562985669658');
  });

  it('mantém fixo BR sem adicionar 9 (10 dígitos nacionais)', () => {
    expect(normalizePhoneForStorage('6233334444')).toBe('+556233334444');
  });
});
