import { describe, expect, it } from 'vitest';
import { maskDocument, maskEmail, maskName, maskPhone, maskPiiFields } from './pii-mask.js';

describe('maskEmail', () => {
  it('returns null for null/undefined/empty', () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
    expect(maskEmail('')).toBeNull();
    expect(maskEmail('   ')).toBeNull();
  });

  it('masks standard email keeping first char and domain', () => {
    expect(maskEmail('joao@example.com')).toBe('j***@example.com');
    expect(maskEmail('ana@empresa.com.br')).toBe('a***@empresa.com.br');
  });

  it('masks single-char local part', () => {
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
  });

  it('returns *** for value without @', () => {
    expect(maskEmail('noemail')).toBe('***');
  });

  it('handles @ at position 0', () => {
    expect(maskEmail('@domain.com')).toBe('***');
  });
});

describe('maskPhone', () => {
  it('returns null for null/undefined/empty', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone('')).toBeNull();
    expect(maskPhone('abc')).toBeNull();
  });

  it('masks BR mobile (11 digits) showing area code, first digit and last 4', () => {
    const result = maskPhone('(11) 99999-8888');
    expect(result).toBe('(11) 9****-8888');
  });

  it('masks BR landline (10 digits) showing area code, first digit and last 4', () => {
    const result = maskPhone('(21) 3333-4444');
    expect(result).toBe('(21) 3***-4444');
  });

  it('masks international number with country code', () => {
    const result = maskPhone('+5511987654321');
    expect(result).toContain('(11)');
    expect(result).toContain('+55');
  });

  it('masks short numbers keeping last 4 digits', () => {
    const result = maskPhone('12345');
    expect(result).toBe('*2345');
  });
});

describe('maskDocument', () => {
  it('returns null for null/undefined/empty', () => {
    expect(maskDocument(null)).toBeNull();
    expect(maskDocument(undefined)).toBeNull();
    expect(maskDocument('')).toBeNull();
    expect(maskDocument('abc')).toBeNull();
  });

  it('masks CPF (11 digits)', () => {
    expect(maskDocument('123.456.789-09')).toBe('***.***.789-09');
  });

  it('masks CNPJ (14 digits)', () => {
    expect(maskDocument('12.345.678/0001-95')).toBe('**.***.678/0001-**');
  });

  it('masks short numeric documents', () => {
    expect(maskDocument('1234')).toBe('****');
    expect(maskDocument('12345')).toBe('*2345');
  });
});

describe('maskName', () => {
  it('returns null for null/undefined/empty', () => {
    expect(maskName(null)).toBeNull();
    expect(maskName(undefined)).toBeNull();
    expect(maskName('')).toBeNull();
    expect(maskName('   ')).toBeNull();
  });

  it('masks full name keeping first name and initial of last name', () => {
    expect(maskName('João da Silva Santos')).toBe('João S***');
  });

  it('keeps single-name unchanged', () => {
    expect(maskName('Joao')).toBe('Joao');
  });

  it('masks two-part name', () => {
    expect(maskName('Ana Lima')).toBe('Ana L***');
  });
});

describe('maskPiiFields', () => {
  it('masks email, phone, whatsapp and document fields', () => {
    const result = maskPiiFields({
      email: 'test@example.com',
      phone: '(11) 99999-8888',
      whatsapp: '(11) 99999-8888',
      document: '123.456.789-09',
    });
    expect(result.email).toBe('t***@example.com');
    expect(result.phone).toBe('(11) 9****-8888');
    expect(result.whatsapp).toBe('(11) 9****-8888');
    expect(result.document).toBe('***.***.789-09');
  });

  it('preserves non-pii fields', () => {
    const result = maskPiiFields({ email: 'a@b.com', name: 'Test', age: 30 } as unknown as { email: string });
    expect((result as Record<string, unknown>).name).toBe('Test');
    expect((result as Record<string, unknown>).age).toBe(30);
  });

  it('handles null values gracefully', () => {
    const result = maskPiiFields({ email: null, phone: null, document: null });
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.document).toBeNull();
  });
});
