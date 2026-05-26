import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/setup.js';

const DPO_FIELDS = ['name', 'email', 'phone', 'privacyPolicyUrl', 'termsUrl'] as const;

describe('GET /api/legal/dpo', () => {
  it('retorna 200 sem token de autenticação', async () => {
    const res = await createTestApp().get('/api/legal/dpo');
    expect(res.status).toBe(200);
  });

  it('retorna payload com todos os campos esperados', async () => {
    const res = await createTestApp().get('/api/legal/dpo');
    expect(res.status).toBe(200);
    for (const field of DPO_FIELDS) {
      expect(res.body).toHaveProperty(field);
    }
  });

  it('cada campo é string ou null — não falha quando env vars ausentes', async () => {
    const res = await createTestApp().get('/api/legal/dpo');
    expect(res.status).toBe(200);
    for (const field of DPO_FIELDS) {
      const val = (res.body as Record<string, unknown>)[field];
      expect(val === null || typeof val === 'string').toBe(true);
    }
  });
});
