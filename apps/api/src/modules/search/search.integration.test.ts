import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';

const TEST_AUTH_SUB = '00000000-0000-0000-0000-000000000072';

function requireSchema(): string {
  const s = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!s) throw new Error('Schema de teste não inicializado');
  return s;
}

function authHeader(): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_AUTH_SUB,
      email: 'search.integration@ziradesk.test',
      name: 'Search Integration User',
      role: 'owner',
    })}`,
  };
}

describe('Search integration', () => {
  const CONTACT_NAME = `SearchContact_${Date.now()}`;

  beforeAll(async () => {
    const schema = requireSchema();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".contacts (name, email) VALUES ($1, $2)`,
      CONTACT_NAME,
      `search_${Date.now()}@ziradesk.test`,
    );
  });

  afterAll(async () => {
    const schema = requireSchema();
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${schema}".contacts WHERE name = $1`,
      CONTACT_NAME,
    );
  });

  it('GET /api/search?q=termo retorna contacts correspondentes do tenant autenticado', async () => {
    const response = await createTestApp()
      .get('/api/search')
      .query({ q: CONTACT_NAME })
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      contacts: expect.arrayContaining([
        expect.objectContaining({ name: CONTACT_NAME }),
      ]),
      tickets: expect.any(Array),
      conversations: expect.any(Array),
    });
  });

  it('GET /api/search com query vazia retorna listas vazias sem erro', async () => {
    const response = await createTestApp()
      .get('/api/search')
      .query({ q: '' })
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      contacts: [],
      tickets: [],
      conversations: [],
    });
  });

  it('GET /api/search sem autenticação retorna 401', async () => {
    const response = await createTestApp()
      .get('/api/search')
      .query({ q: 'qualquer' });

    expect(response.status).toBe(401);
  });
});
