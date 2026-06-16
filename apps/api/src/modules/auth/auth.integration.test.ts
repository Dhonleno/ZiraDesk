import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { redis } from '../../config/redis.js';
import { createTestApp } from '../../test/setup.js';

const REFRESH_COOKIE = env.REFRESH_COOKIE_NAME ?? 'zd_refresh';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_EMAIL = 'integration@test.ziradesk.com';
const TEST_PASSWORD = 'Integration#123';

function requiredTenantSlug(): string {
  const slug = globalThis.__ZIRADESK_TEST_TENANT_SLUG__;
  if (!slug) {
    throw new Error('Tenant de teste não inicializado');
  }
  return slug;
}

async function waitUntilAfter(timestampMs: number): Promise<void> {
  while (Date.now() <= timestampMs) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('Auth integration', () => {
  beforeEach(async () => {
    await redis.del(`auth:force_logout_after:${TEST_USER_ID}`);
  });

  it('POST /api/auth/login com credenciais válidas retorna access token', async () => {
    const response = await createTestApp()
      .post('/api/auth/login')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        tenantSlug: requiredTenantSlug(),
      });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user.email).toBe(TEST_EMAIL);
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${REFRESH_COOKIE}=`)]),
    );
  });

  it('POST /api/auth/login invalida access token anterior do mesmo usuário', async () => {
    const firstLogin = await createTestApp()
      .post('/api/auth/login')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        tenantSlug: requiredTenantSlug(),
      });

    expect(firstLogin.status).toBe(200);
    const firstAccessToken = firstLogin.body.accessToken as string;
    const firstRefreshCookie = firstLogin.headers['set-cookie'];
    expect(firstRefreshCookie).toBeDefined();
    const firstPayload = jwt.verify(firstAccessToken, env.JWT_SECRET) as { iatMs: number };

    const beforeSecondLogin = await createTestApp()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${firstAccessToken}`);
    expect(beforeSecondLogin.status).toBe(200);

    await waitUntilAfter(firstPayload.iatMs + 1);

    const secondLogin = await createTestApp()
      .post('/api/auth/login')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        tenantSlug: requiredTenantSlug(),
    });

    expect(secondLogin.status).toBe(200);

    const afterSecondLogin = await createTestApp()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${firstAccessToken}`);
    expect(afterSecondLogin.status).toBe(401);

    const refreshWithOldCookie = await createTestApp()
      .post('/api/auth/refresh')
      .set('Cookie', firstRefreshCookie!);
    expect(refreshWithOldCookie.status).toBe(401);
  });

  it('POST /api/auth/login com credenciais inválidas retorna 401', async () => {
    const response = await createTestApp()
      .post('/api/auth/login')
      .send({
        email: TEST_EMAIL,
        password: 'SenhaErrada#999',
        tenantSlug: requiredTenantSlug(),
      });

    expect(response.status).toBe(401);
  });

  it('POST /api/auth/refresh com cookie válido retorna novo access token', async () => {
    const login = await createTestApp()
      .post('/api/auth/login')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        tenantSlug: requiredTenantSlug(),
      });

    const cookieHeader = login.headers['set-cookie'];
    expect(cookieHeader).toBeDefined();

    const refresh = await createTestApp()
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader!);

    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toEqual(expect.any(String));
  });

  it('POST /api/auth/refresh com token legado (sem iatMs) é bloqueado após novo login', async () => {
    const legacyRefreshToken = jwt.sign(
      {
        sub: TEST_USER_ID,
        email: TEST_EMAIL,
        name: 'Integration Test User',
        role: 'owner',
        tenantId: globalThis.__ZIRADESK_TEST_TENANT_ID__,
        schemaName: globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__,
        isSuperAdmin: false,
        // sem iatMs — simula token emitido antes do deploy da feature de sessão única
      },
      env.JWT_REFRESH_SECRET,
      { expiresIn: '5m' },
    );

    // Simula novo login ocorrido após a emissão do token legado
    await redis.set(`auth:force_logout_after:${TEST_USER_ID}`, (Date.now() + 1).toString(), 'EX', 60);

    const response = await createTestApp()
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${legacyRefreshToken}`);

    expect(response.status).toBe(401);
  });

  it('POST /api/auth/refresh sincroniza o papel atual do usuário no banco', async () => {
    const staleRefreshToken = jwt.sign(
      {
        sub: TEST_USER_ID,
        email: TEST_EMAIL,
        name: 'Integration Test User',
        role: 'agent',
        tenantId: globalThis.__ZIRADESK_TEST_TENANT_ID__,
        schemaName: globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__,
        isSuperAdmin: false,
      },
      env.JWT_REFRESH_SECRET,
      { expiresIn: '5m' },
    );

    const response = await createTestApp()
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${staleRefreshToken}`);

    expect(response.status).toBe(200);
    const accessPayload = jwt.verify(response.body.accessToken, env.JWT_SECRET) as { role: string };
    expect(accessPayload.role).toBe('owner');
  });

  it('POST /api/auth/refresh com cookie expirado retorna 401', async () => {
    const expiredToken = jwt.sign(
      {
        sub: TEST_USER_ID,
        email: TEST_EMAIL,
        name: 'Integration Test User',
        role: 'owner',
        tenantId: globalThis.__ZIRADESK_TEST_TENANT_ID__,
        schemaName: globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__,
        isSuperAdmin: false,
      },
      env.JWT_REFRESH_SECRET,
      { expiresIn: -10 },
    );

    const response = await createTestApp()
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${expiredToken}`);

    expect(response.status).toBe(401);
  });

  it('POST /api/auth/logout invalida sessão', async () => {
    const login = await createTestApp()
      .post('/api/auth/login')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        tenantSlug: requiredTenantSlug(),
      });

    const accessToken = login.body.accessToken as string;

    const beforeLogout = await createTestApp()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(beforeLogout.status).toBe(200);

    const logout = await createTestApp()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logout.status).toBe(200);

    const afterLogout = await createTestApp()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(afterLogout.status).toBe(401);
  });
});
